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

  it('adds asphalt variation and rural edge markings to the production road', () => {
    const hm = generateHeightmap(16, 16, 1, { seed: 'flat', frequency: 0, amplitude: 0, octaves: 1, persistence: 1 });
    const roads = new RoadsVisual(hm);

    roads.addPath([
      { x: 2, z: 2 },
      { x: 12, z: 2 },
    ]);

    const surface = roads.group.children.find((child) => child.name === 'road-surface') as Mesh;
    expect(surface.geometry.getAttribute('color')).toBeDefined();
    const surfaceMaterial = Array.isArray(surface.material) ? surface.material[0] : surface.material;
    expect(surfaceMaterial.vertexColors).toBe(true);
    expect(roads.group.getObjectByName('road-edge-markings')).toBeDefined();
  });

  it('suppresses center and edge markings across an intersection apron', () => {
    const hm = generateHeightmap(64, 64, 1, { seed: 'flat', frequency: 0, amplitude: 0, octaves: 1, persistence: 1 });
    const roads = new RoadsVisual(hm);

    roads.addPath([{ x: 8, z: 32 }, { x: 56, z: 32 }]);
    roads.addPath([{ x: 32, z: 8 }, { x: 32, z: 56 }]);
    const before = (roads.group.getObjectByName('road-center-stripe') as Mesh).geometry.getAttribute('position').count;

    roads.buildIntersections();

    const after = (roads.group.getObjectByName('road-center-stripe') as Mesh).geometry.getAttribute('position').count;
    expect(after).toBeLessThan(before);
    expect(roads.group.getObjectsByProperty('name', 'road-intersection-apron')).toHaveLength(1);
  });

  it('uses planar arc distance for marking suppression on a steep road', () => {
    const hm = {
      width: 64,
      height: 64,
      scale: 1,
      data: new Float32Array(65 * 65),
      sample: (x: number, z: number) => x * 0.8 + z * 0.2,
    };
    const roads = new RoadsVisual(hm);
    roads.addPath([{ x: 8, z: 32 }, { x: 56, z: 32 }]);
    roads.addPath([{ x: 32, z: 8 }, { x: 32, z: 56 }]);
    roads.buildIntersections();

    const intersection = roads.getIntersectionsForPath(0)[0].pos;
    const centerStripes = roads.group.getObjectsByProperty('name', 'road-center-stripe') as Mesh[];
    for (const stripe of centerStripes) {
      const positions = stripe.geometry.getAttribute('position');
      for (let i = 0; i < positions.count; i++) {
        const distance = Math.hypot(positions.getX(i) - intersection.x, positions.getZ(i) - intersection.z);
        expect(distance).toBeGreaterThan(1.8);
      }
    }

    const apron = roads.group.getObjectsByProperty('name', 'road-intersection-apron')[0] as Mesh;
    expect(apron.position.y).toBeCloseTo(hm.sample(apron.position.x, apron.position.z) + 0.324, 4);
  });
});
