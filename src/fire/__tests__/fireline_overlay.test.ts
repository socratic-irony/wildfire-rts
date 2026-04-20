import { describe, it, expect } from 'vitest';
import { generateHeightmap } from '../../terrain/heightmap';
import { computeBiomes } from '../../terrain/biomes';
import { buildFireGrid, writeFirelineEdges } from '../grid';
import { createFirelineOverlay } from '../firelineOverlay';

function makeGrid(size = 8) {
  const hm = generateHeightmap(size, size, 1, { seed: 's', frequency: 0, amplitude: 0, octaves: 1, persistence: 1 });
  return { hm, grid: buildFireGrid(hm, computeBiomes(hm)) };
}

describe('firelineOverlay', () => {
  it('renders one instance per tile with lineStrength above the threshold', () => {
    const { hm, grid } = makeGrid(8);
    const overlay = createFirelineOverlay(hm, { threshold: 0.5 });

    overlay.update(grid);
    expect((overlay.inst as any).count).toBe(0);

    writeFirelineEdges(grid, [{ x: 1, z: 1 }, { x: 2, z: 1 }, { x: 3, z: 1 }], 1.0);
    overlay.update(grid);
    expect((overlay.inst as any).count).toBe(3);
  });

  it('ignores tiles below the strength threshold', () => {
    const { hm, grid } = makeGrid(8);
    const overlay = createFirelineOverlay(hm, { threshold: 0.5 });

    writeFirelineEdges(grid, [{ x: 1, z: 1 }], 0.25);
    overlay.update(grid);
    expect((overlay.inst as any).count).toBe(0);

    writeFirelineEdges(grid, [{ x: 1, z: 1 }], 0.75);
    overlay.update(grid);
    expect((overlay.inst as any).count).toBe(1);
  });

  it('exposes visibility toggle', () => {
    const { hm } = makeGrid(4);
    const overlay = createFirelineOverlay(hm);
    overlay.setVisible(false);
    expect(overlay.inst.visible).toBe(false);
    overlay.setVisible(true);
    expect(overlay.inst.visible).toBe(true);
  });
});
