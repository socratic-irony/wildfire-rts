import { describe, expect, it } from 'vitest';
import { DoubleSide, Line, Mesh } from 'three';
import { generateHeightmap } from '../../terrain/heightmap';
import { RoadsVisual } from '../visual';

function countRoadDiagnostics(roads: RoadsVisual) {
  let wireframes = 0;
  let lines = 0;
  roads.group.traverse((child) => {
    let rendered = child.visible;
    for (let parent = child.parent; rendered && parent; parent = parent.parent) {
      rendered = parent.visible;
    }
    if (!rendered) return;
    if (child instanceof Mesh) {
      const material = Array.isArray(child.material) ? child.material[0] : child.material;
      if ((material as { wireframe?: boolean }).wireframe) wireframes++;
    }
    if (child instanceof Line) lines++;
  });
  return { wireframes, lines };
}

describe('RoadsVisual debug diagnostics', () => {
  it('does not render road lattice diagnostics by default', () => {
    const hm = generateHeightmap(16, 16, 1, { seed: 'flat', frequency: 0, amplitude: 0, octaves: 1, persistence: 1 });
    const roads = new RoadsVisual(hm);

    roads.addPath([
      { x: 2, z: 2 },
      { x: 12, z: 2 },
      { x: 12, z: 10 },
    ]);

    expect(countRoadDiagnostics(roads)).toEqual({ wireframes: 0, lines: 0 });
  });

  it('renders road lattice diagnostics only when enabled', () => {
    const hm = generateHeightmap(16, 16, 1, { seed: 'flat', frequency: 0, amplitude: 0, octaves: 1, persistence: 1 });
    const roads = new RoadsVisual(hm);

    roads.addPath([
      { x: 2, z: 2 },
      { x: 12, z: 2 },
      { x: 12, z: 10 },
    ]);
    roads.setDebugDiagnosticsVisible(true);

    expect(countRoadDiagnostics(roads)).toEqual({ wireframes: 1, lines: 1 });
  });

  it('renders filled road surfaces with double-sided materials', () => {
    const hm = generateHeightmap(16, 16, 1, { seed: 'flat', frequency: 0, amplitude: 0, octaves: 1, persistence: 1 });
    const roads = new RoadsVisual(hm);

    roads.addPath([
      { x: 2, z: 2 },
      { x: 12, z: 2 },
      { x: 12, z: 10 },
    ]);

    const visibleMeshes: Mesh[] = [];
    roads.group.traverse((child) => {
      if (child instanceof Mesh && child.visible) {
        const material = Array.isArray(child.material) ? child.material[0] : child.material;
        if (!(material as { wireframe?: boolean }).wireframe) visibleMeshes.push(child);
      }
    });
    expect(visibleMeshes.length).toBeGreaterThanOrEqual(3);
    expect(visibleMeshes.every((mesh) => {
      const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      return material.side === DoubleSide;
    })).toBe(true);
  });

  it('renders exactly one depth-tested production road surface', () => {
    const hm = generateHeightmap(16, 16, 1, { seed: 'flat', frequency: 0, amplitude: 0, octaves: 1, persistence: 1 });
    const roads = new RoadsVisual(hm);

    roads.addPath([
      { x: 2, z: 2 },
      { x: 12, z: 2 },
      { x: 12, z: 10 },
    ]);

    const surfaces: Mesh[] = [];
    roads.group.traverse((child) => {
      if (child instanceof Mesh && child.name === 'road-surface') surfaces.push(child);
    });

    expect(surfaces).toHaveLength(1);
    const material = Array.isArray(surfaces[0].material) ? surfaces[0].material[0] : surfaces[0].material;
    expect(material.depthTest).toBe(true);
    expect(material.depthWrite).toBe(true);
  });
});
