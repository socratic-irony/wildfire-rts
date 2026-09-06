import { describe, expect, it } from 'vitest';
import { Mesh } from 'three';
import { generateHeightmap } from '../heightmap';
import { computeBiomes } from '../biomes';
import { buildChunkedTerrain } from '../chunks';
import { createTerrainMaterial } from '../material';
import { buildFireGrid, FireState } from '../../fire/grid';
import { createFireViz } from '../../fire/viz';

describe('terrain fire tint', () => {
  it('preserves finite skirt colors through fire states at both detail levels', () => {
    const hm = generateHeightmap(8, 8, 1, {seed: 7, frequency: 1, amplitude: 1, octaves: 2, persistence: 0.5});
    const biomes = computeBiomes(hm);
    const grid = buildFireGrid(hm, biomes);
    const material = createTerrainMaterial();
    const terrain = buildChunkedTerrain(hm, material, 4, biomes);
    const viz = createFireViz(hm, terrain.group);
    viz.setMode('vertex');
    for (const level of ['Hi', 'Lo']) {
      for (const child of terrain.group.children) {
        const mesh = child as Mesh;
        mesh.geometry = mesh.userData[`geo${level}`];
      }
      for (const state of [FireState.Burning, FireState.Smoldering, FireState.Burned, FireState.Unburned]) {
        grid.state.fill(state);
        viz.update(grid, 0.5);
        for (const child of terrain.group.children) {
          const mesh = child as Mesh;
          const colors = mesh.geometry.getAttribute('color').array;
          expect(Array.from(colors).every(Number.isFinite)).toBe(true);
          if (state === FireState.Unburned) expect(Array.from(colors)).toEqual(Array.from(mesh.userData[`baseColors${level}`]));
        }
      }
    }
    terrain.dispose();
    material.dispose();
  });
});
