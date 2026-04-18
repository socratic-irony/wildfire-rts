/**
 * Regression: dispatchLoop.pushGoal must not teleport followers between
 * disconnected road polylines when auto-assigning an incident.
 */

import { describe, it, expect, vi } from 'vitest';
import { generateHeightmap } from '../../terrain/heightmap';
import { computeBiomes } from '../../terrain/biomes';
import { buildFireGrid, FireState } from '../../fire/grid';
import { createIncidentRegistry } from '../../dispatch/incident';
import { createDispatchLoop, type FollowerRef } from '../dispatchLoop';
import { VehicleType } from '../../vehicles/types';
import type { Path2D } from '../../paths/path2d';
import type { PathFollower } from '../../vehicles/frenet';

function flatGrid(size = 8) {
  const hm = generateHeightmap(size, size, 1, { seed: 'flat', frequency: 0, amplitude: 0, octaves: 1, persistence: 1 });
  const biomes = computeBiomes(hm);
  return buildFireGrid(hm, biomes, { cellSize: 1 });
}

function mockPath(pts: Array<{ x: number; z: number }>, id: number): Path2D {
  return {
    __id: id, // for identity checks
    length: 100,
    closed: false,
    project: (p: { x: number; z: number }) => {
      let best = 0, bestD = Infinity;
      for (let i = 0; i < pts.length; i++) {
        const d = Math.hypot(pts[i].x - p.x, pts[i].z - p.z);
        if (d < bestD) { bestD = d; best = i * 10; }
      }
      return { s: best, dist: bestD, t: { x: 1, z: 0 } };
    },
    sample: () => ({ p: { x: 0, z: 0 }, t: { x: 1, z: 0 } }),
  } as unknown as Path2D;
}

function mockRef(id: number, path: Path2D, pos: { x: number; z: number }): FollowerRef {
  const posVec = { x: pos.x, y: 0, z: pos.z };
  const follower = {
    path,
    s: 0,
    v: 0,
    setTargetS: vi.fn(),
    clearTarget: vi.fn(),
    object: {
      getWorldPosition: (out: any) => { out.x = posVec.x; out.y = 0; out.z = posVec.z; return out; },
    },
  } as unknown as PathFollower;
  return { id, type: VehicleType.FIRETRUCK, follower, busy: false };
}

describe('dispatch_loop_does_not_teleport_path_on_assignment', () => {
  it('follower.path is unchanged after auto-assignment', () => {
    const grid = flatGrid();
    grid.tiles[0].state = FireState.Burning;

    const registry = createIncidentRegistry(1);
    const loop = createDispatchLoop(registry, { detectInterval: 1.0, autoDispatch: true });

    const pathA = mockPath([{ x: 0, z: 0 }, { x: 10, z: 0 }], 0);
    const pathB = mockPath([{ x: 0, z: 50 }, { x: 10, z: 50 }], 1); // disconnected road

    const ref = mockRef(1, pathA, { x: 1, z: 1 });
    const originalPath = ref.follower.path;

    // Provide both paths — the old code would pick the nearest to the incident
    // and swap the follower's path; the new code should keep pathA.
    loop.tick(1.1, 1.1, grid, [ref], [pathA, pathB]);

    expect(ref.follower.path).toBe(originalPath);
    // setTargetS should still be called (move order on current path)
    expect(ref.follower.setTargetS).toHaveBeenCalled();
  });

  it('follower on a path not in the list is not given a goal', () => {
    const grid = flatGrid();
    grid.tiles[0].state = FireState.Burning;

    const registry = createIncidentRegistry(1);
    const loop = createDispatchLoop(registry, { detectInterval: 1.0, autoDispatch: true });

    const pathA = mockPath([{ x: 0, z: 0 }, { x: 10, z: 0 }], 0);
    const pathUnknown = mockPath([{ x: 0, z: 0 }, { x: 10, z: 0 }], 99);

    // follower is on pathUnknown which is NOT in the provided path list
    const ref = mockRef(1, pathUnknown, { x: 1, z: 1 });

    loop.tick(1.1, 1.1, grid, [ref], [pathA]);

    // No path change, no setTargetS since current path not found in list
    expect(ref.follower.path).toBe(pathUnknown);
    expect(ref.follower.setTargetS).not.toHaveBeenCalled();
  });
});
