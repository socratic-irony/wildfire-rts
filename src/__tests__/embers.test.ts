import { describe, it, expect } from 'vitest';
import { generateHeightmap } from '../terrain/heightmap';
import { buildFireGrid, ignite } from '../fire/grid';
import { computeBiomes } from '../terrain/biomes';
import { createEmbers, selectEmberSources, EMBER_CAP } from '../particles/embers';

describe('selectEmberSources (pure spawn selection)', () => {
  it('is deterministic for identical inputs', () => {
    const a = selectEmberSources(5000, 12345, EMBER_CAP);
    const b = selectEmberSources(5000, 12345, EMBER_CAP);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('respects the cap and keeps indices in bounds', () => {
    const sel = selectEmberSources(50000, 7, EMBER_CAP);
    expect(sel.length).toBe(EMBER_CAP);
    for (const idx of sel) {
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(50000);
    }
  });

  it('never duplicates frontier slots', () => {
    const sel = selectEmberSources(3000, 99, EMBER_CAP);
    expect(new Set(sel).size).toBe(sel.length);
  });

  it('covers the whole frontier when bCount <= cap', () => {
    const sel = selectEmberSources(42, 5, EMBER_CAP);
    expect(sel.length).toBe(42);
    expect(Array.from(sel)).toEqual(Array.from({ length: 42 }, (_, i) => i));
  });

  it('yields different selections for different seeds', () => {
    const a = Array.from(selectEmberSources(20000, 1, 1000));
    const b = Array.from(selectEmberSources(20000, 2, 1000));
    expect(a).not.toEqual(b);
  });
});

describe('ember particle system', () => {
  it('spawns deterministically from the burning frontier within the cap', () => {
    const hm = generateHeightmap(16, 16, 1, { seed: 't', frequency: 1, amplitude: 1, octaves: 1, persistence: 0.5 });
    const biomes = computeBiomes(hm);
    const grid = buildFireGrid(hm, biomes, { cellSize: hm.scale });
    ignite(grid, [{ x: 8, z: 8 }, { x: 4, z: 4 }, { x: 12, z: 9 }], 0.9);

    const embers = createEmbers(hm);
    expect(embers.group.children.length).toBeGreaterThan(0);

    const cam: any = { matrixWorld: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 10, 20, 1] }, position: { x: 10, y: 10, z: 20 } };
    embers.update(grid as any, { windDirRad: Math.PI / 2, windSpeed: 3 }, 0.016, cam);

    const mesh: any = embers.group.children[0];
    expect(mesh.count).toBeGreaterThan(0);
    expect(mesh.count).toBeLessThanOrEqual(EMBER_CAP);

    // Deterministic rebuild: identical state -> identical instance count.
    const count = mesh.count;
    embers.update(grid as any, { windDirRad: Math.PI / 2, windSpeed: 3 }, 0.016, cam);
    expect(mesh.count).toBe(count);
  });

  it('setEnabled(false) zeroes the draw count', () => {
    const hm = generateHeightmap(8, 8, 1, { seed: 't2', frequency: 1, amplitude: 1, octaves: 1, persistence: 0.5 });
    const biomes = computeBiomes(hm);
    const grid = buildFireGrid(hm, biomes, { cellSize: hm.scale });
    ignite(grid, [{ x: 3, z: 3 }], 0.9);
    const embers = createEmbers(hm);
    const mesh: any = embers.group.children[0];
    embers.setEnabled(false);
    expect(mesh.visible).toBe(false);
    const cam: any = { matrixWorld: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 10, 20, 1] }, position: { x: 0, y: 5, z: 5 } };
    embers.update(grid as any, { windDirRad: 0, windSpeed: 0 }, 0.016, cam);
    expect(mesh.count).toBe(0);
    embers.setEnabled(true);
    expect(mesh.visible).toBe(true);
  });

  it('updateTerrain rebinds without throwing', () => {
    const hm = generateHeightmap(8, 8, 1, { seed: 't3', frequency: 1, amplitude: 1, octaves: 1, persistence: 0.5 });
    const embers = createEmbers(hm);
    const hm2 = generateHeightmap(8, 8, 1, { seed: 'other', frequency: 1, amplitude: 2, octaves: 2, persistence: 0.5 });
    expect(() => embers.updateTerrain(hm2)).not.toThrow();
  });
});
