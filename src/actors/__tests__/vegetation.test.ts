import { describe, expect, it } from 'vitest';
import { buildFireGrid, FireState } from '../../fire/grid';
import { createShrubs, MAX_SHRUB_INSTANCES_PER_BATCH } from '../shrubs';
import { createForest, MAX_TREE_INSTANCES_PER_BATCH } from '../trees';
import type { BiomeMask } from '../../terrain/biomes';
import type { Heightmap } from '../../terrain/heightmap';

function makeFixture(): { hm: Heightmap; biomes: BiomeMask } {
  const width = 32;
  const height = 32;
  const hm: Heightmap = {
    width,
    height,
    scale: 1,
    data: new Float32Array((width + 1) * (height + 1)),
    sample: () => 0,
  };
  const vertexCount = (width + 1) * (height + 1);
  return {
    hm,
    biomes: {
      rock: new Uint8Array(vertexCount),
      forest: new Uint8Array(vertexCount).fill(1),
      chaparral: new Uint8Array(vertexCount),
    },
  };
}

describe('procedural vegetation families', () => {
  it('builds four deterministic tree silhouettes in bounded instanced batches', () => {
    const { hm, biomes } = makeFixture();
    const first = createForest(hm, biomes, { density: 1, broadleafRatio: 0.5 });
    const second = createForest(hm, biomes, { density: 1, broadleafRatio: 0.5 });

    expect(Object.keys(first.families)).toEqual(['pine', 'tallFir', 'roundedBroadleaf', 'spreadingOak']);
    expect(Object.values(first.families).every((family) => family.count > 0)).toBe(true);
    expect(Object.values(first.families).every((family) => family.meshes.length <= 2)).toBe(true);
    expect(Object.values(first.families).map((family) => family.parts)).toEqual(
      Object.values(second.families).map((family) => family.parts),
    );
    expect(Object.values(first.families).map((family) => family.count)).toEqual(
      Object.values(second.families).map((family) => family.count),
    );
    expect(first.meshes.length).toBeLessThanOrEqual(8);
    expect(first.meshes.every((mesh) => mesh.count <= MAX_TREE_INSTANCES_PER_BATCH)).toBe(true);
    expect(first.meshes.map((mesh) => mesh.geometry.name)).toEqual(second.meshes.map((mesh) => mesh.geometry.name));
    expect(first.meshes.map((mesh) => Array.from(mesh.instanceMatrix.array))).toEqual(
      second.meshes.map((mesh) => Array.from(mesh.instanceMatrix.array)),
    );
    expect(new Set(Object.values(first.families).flatMap((family) => family.parts)).size).toBeGreaterThan(2);

    first.dispose();
    second.dispose();
  });

  it('restores tree base colors after a burned state is cleared', () => {
    const { hm, biomes } = makeFixture();
    const forest = createForest(hm, biomes, { density: 1 });
    const grid = buildFireGrid(hm, biomes);
    const mesh = forest.meshes[0];
    const before = Array.from(mesh.instanceColor?.array ?? []);

    grid.state.fill(FireState.Burned);
    forest.applyFireTint(grid);
    expect(Array.from(mesh.instanceColor?.array ?? [])).not.toEqual(before);

    grid.state.fill(FireState.Unburned);
    forest.applyFireTint(grid);
    expect(Array.from(mesh.instanceColor?.array ?? [])).toEqual(before);
    forest.dispose();
  });

  it('removes excluded trees without reshuffling later deterministic placements', () => {
    const { hm, biomes } = makeFixture();
    const baseline = createForest(hm, biomes, { density: 1, broadleafRatio: 0.5 });
    const excluded = baseline.instances.pine[0] ?? baseline.instances.tallFir[0];
    if (!excluded) throw new Error('fixture did not produce a conifer');
    const filtered = createForest(hm, biomes, {
      density: 1,
      broadleafRatio: 0.5,
      exclude: (position) => position.gridX === excluded.gx && position.gridZ === excluded.gz,
    });

    for (const family of Object.keys(baseline.instances) as Array<keyof typeof baseline.instances>) {
      const expected = baseline.instances[family]
        .filter((item) => item.gx !== excluded.gx || item.gz !== excluded.gz)
        .map((item) => [item.gx, item.gz, item.rot, item.scale, item.height, item.leafCol.toArray(), item.trunkCol.toArray()]);
      const actual = filtered.instances[family]
        .map((item) => [item.gx, item.gz, item.rot, item.scale, item.height, item.leafCol.toArray(), item.trunkCol.toArray()]);
      expect(actual).toEqual(expected);
    }

    const mask = new Uint8Array(hm.width * hm.height);
    mask[excluded.gz * hm.width + excluded.gx] = 1;
    const maskFiltered = createForest(hm, biomes, {
      density: 1,
      broadleafRatio: 0.5,
      exclusionMask: { width: hm.width, height: hm.height, data: mask },
    });
    expect(Object.values(maskFiltered.instances).flat().some((item) => item.gx === excluded.gx && item.gz === excluded.gz)).toBe(false);

    baseline.dispose();
    filtered.dispose();
    maskFiltered.dispose();
  });

  it('builds three distinct shrub silhouettes with bounded instanced batches', () => {
    const { hm, biomes } = makeFixture();
    biomes.forest.fill(0);
    biomes.chaparral.fill(1);
    const shrubs = createShrubs(hm, biomes, { density: 1 });

    expect(Object.keys(shrubs.families)).toEqual(['roundedMultiLobed', 'lowSpreadingScrub', 'uprightBrush']);
    expect(Object.values(shrubs.families).every((family) => family.count > 0)).toBe(true);
    expect(Object.values(shrubs.families).every((family) => family.meshes.length === 1)).toBe(true);
    expect(shrubs.meshes.length).toBeLessThanOrEqual(3);
    expect(shrubs.meshes.every((mesh) => mesh.count <= MAX_SHRUB_INSTANCES_PER_BATCH)).toBe(true);
    expect(new Set(Object.values(shrubs.families).flatMap((family) => family.parts)).size).toBeGreaterThan(2);
    shrubs.dispose();
  });

  it('restores shrub base colors after a burned state is cleared', () => {
    const { hm, biomes } = makeFixture();
    biomes.forest.fill(0);
    biomes.chaparral.fill(1);
    const shrubs = createShrubs(hm, biomes, { density: 1 });
    const grid = buildFireGrid(hm, biomes);
    const mesh = shrubs.meshes[0];
    const before = Array.from(mesh.instanceColor?.array ?? []);

    grid.state.fill(FireState.Burned);
    shrubs.applyFireTint(grid);
    expect(Array.from(mesh.instanceColor?.array ?? [])).not.toEqual(before);

    grid.state.fill(FireState.Unburned);
    shrubs.applyFireTint(grid);
    expect(Array.from(mesh.instanceColor?.array ?? [])).toEqual(before);
    shrubs.dispose();
  });
});
