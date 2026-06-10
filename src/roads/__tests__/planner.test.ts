import { describe, expect, it } from 'vitest';
import { generateHeightmap } from '../../terrain/heightmap';
import { buildTerrainCost } from '../cost';
import { buildPlannedRoadPath } from '../planner';

describe('road planner', () => {
  it('builds an angular road path with stable endpoints', () => {
    const hm = generateHeightmap(16, 16, 1, { seed: 'flat', frequency: 0, amplitude: 0, octaves: 1, persistence: 1 });
    const roadCost = buildTerrainCost(hm);

    const path = buildPlannedRoadPath(hm, roadCost, { x: 2, z: 2 }, { x: 12, z: 10 });

    expect(path.length).toBeGreaterThan(1);
    expect(path[0]).toEqual({ x: 2, z: 2 });
    expect(path[path.length - 1]).toEqual({ x: 12, z: 10 });
  });
});
