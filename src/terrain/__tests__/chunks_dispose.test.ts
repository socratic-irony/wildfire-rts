import { describe, it, expect, vi } from 'vitest';
import { BufferGeometry, Material } from 'three';
import { generateHeightmap } from '../heightmap';
import { createTerrainMaterial } from '../material';
import { buildChunkedTerrain } from '../chunks';

function makeHm(width = 8, height = 4) {
  return generateHeightmap(width, height, 1, {
    seed: 7,
    frequency: 1,
    amplitude: 1,
    octaves: 2,
    persistence: 0.5,
  });
}

describe('buildChunkedTerrain dispose', () => {
  it('disposes both hi/lo geometries of every chunk but keeps the shared material', () => {
    const geoDispose = vi.spyOn(BufferGeometry.prototype, 'dispose');
    const matDispose = vi.spyOn(Material.prototype, 'dispose');
    try {
      // 8x4 tiles with chunkSize 4 → 2 chunks along x, 1 along z.
      const hm = makeHm();
      const mat = createTerrainMaterial() as unknown as Material;
      const chunked = buildChunkedTerrain(hm, mat, 4);
      expect(chunked.group.children.length).toBe(2);

      const callsBefore = geoDispose.mock.calls.length;
      chunked.dispose();

      // Every chunk owns exactly two geometries (hi + lo LOD).
      expect(geoDispose).toHaveBeenCalledTimes(callsBefore + 2 /* chunks */ * 2);
      // The terrain material is shared across rebuilds — never disposed here.
      expect(matDispose).not.toHaveBeenCalled();
    } finally {
      geoDispose.mockRestore();
      matDispose.mockRestore();
    }
  });

  it('is safe to call once children were removed from the group', () => {
    const hm = makeHm(4, 4);
    const chunked = buildChunkedTerrain(hm, createTerrainMaterial() as unknown as Material, 4);
    chunked.dispose(); // must not throw
  });
});
