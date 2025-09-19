import { describe, expect, it } from 'vitest';
import { Group, PerspectiveCamera } from 'three';
import { generateHeightmap } from '../terrain/heightmap';
import { computeBiomes } from '../terrain/biomes';
import { buildFireGrid } from '../fire/grid';
import { createFireParticles } from '../particles/fireParticles';

describe('legacy fire particle system', () => {
  it('creates particle controllers without throwing', () => {
    const hm = generateHeightmap(6, 6, 1, {
      seed: 'particles-test',
      frequency: 0,
      amplitude: 0,
      octaves: 1,
      persistence: 1,
    });
    const biomes = computeBiomes(hm);
    const grid = buildFireGrid(hm, biomes, { spotting: { enabled: false, baseRate: 0, maxDistanceTiles: 0 } });
    const fireParticles = createFireParticles(hm);

    const scene = new Group();
    fireParticles.addToScene(scene);
    expect(scene.children.length).toBeGreaterThan(0);

    fireParticles.setQuality('med');
    fireParticles.update(grid, { windDirRad: 0, windSpeed: 0 }, 0.016, new PerspectiveCamera());

    fireParticles.removeFromScene(scene);
    expect(scene.children.length).toBe(0);
  });
});
