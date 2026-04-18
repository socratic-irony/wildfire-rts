import { describe, it, expect } from 'vitest';
import { generateHeightmap } from '../../terrain/heightmap';
import { computeBiomes } from '../../terrain/biomes';
import { buildFireGrid, ignite, FireState } from '../../fire/grid';
import { createIncidentRegistry } from '../incident';

function flatGrid() {
  const hm = generateHeightmap(8, 8, 1, { seed: 'flat', frequency: 0, amplitude: 0, octaves: 1, persistence: 1 });
  const biomes = computeBiomes(hm);
  return buildFireGrid(hm, biomes, {
    cellSize: 1,
    spotting: { enabled: false, baseRate: 0, maxDistanceTiles: 0 },
  });
}

describe('incident registry', () => {
  it('creates one incident per burning cluster', () => {
    const grid = flatGrid();
    ignite(grid, [{ x: 2, z: 2 }]);
    grid.tiles[2 * grid.width + 2].state = FireState.Burning;

    const reg = createIncidentRegistry(grid.params.cellSize);
    const created = reg.detectFromFireGrid(grid, 0);

    expect(created).toHaveLength(1);
    expect(created[0].status).toBe('detected');
    expect(created[0].tile).toEqual({ x: 2, z: 2 });
  });

  it('does not duplicate incidents on subsequent scans', () => {
    const grid = flatGrid();
    grid.tiles[3 * grid.width + 3].state = FireState.Burning;
    const reg = createIncidentRegistry(grid.params.cellSize);

    reg.detectFromFireGrid(grid, 0);
    const second = reg.detectFromFireGrid(grid, 1);

    expect(second).toHaveLength(0);
    expect(reg.list()).toHaveLength(1);
  });

  it('auto-resolves incidents when tile is no longer hot', () => {
    const grid = flatGrid();
    grid.tiles[1 * grid.width + 1].state = FireState.Burning;
    const reg = createIncidentRegistry(grid.params.cellSize);
    const [inc] = reg.detectFromFireGrid(grid, 0);

    grid.tiles[1 * grid.width + 1].state = FireState.Burned;
    const pruned = reg.prune(grid, 5);

    expect(pruned).toBe(1);
    expect(reg.byId(inc.id)?.status).toBe('resolved');
    expect(reg.byId(inc.id)?.resolvedAt).toBe(5);
  });

  it('tracks lifecycle transitions', () => {
    const grid = flatGrid();
    grid.tiles[0].state = FireState.Burning;
    const reg = createIncidentRegistry(grid.params.cellSize);
    const [inc] = reg.detectFromFireGrid(grid, 0);

    reg.markAssigned(inc.id, [42], 1);
    expect(reg.byId(inc.id)?.status).toBe('assigned');
    expect(reg.byId(inc.id)?.assignedFollowerIds).toEqual([42]);

    reg.markEngaged(inc.id, 2);
    expect(reg.byId(inc.id)?.status).toBe('engaged');

    reg.markResolved(inc.id, 3);
    expect(reg.byId(inc.id)?.status).toBe('resolved');
  });
});
