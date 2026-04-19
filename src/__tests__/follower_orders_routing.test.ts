/**
 * Regression tests for follower order routing — ensures issueMoveOrder /
 * setTargetOnCurrentPath does not teleport followers between disconnected paths.
 */

import { describe, it, expect, vi } from 'vitest';
import { Vector3 } from 'three';
import { VehicleType } from '../vehicles/types';
import { issueMoveOrder, setTargetOnCurrentPath, type FollowerEntry } from '../vehicles/followerOrders';
import type { Path2D } from '../paths/path2d';
import type { PathFollower } from '../vehicles/frenet';

function makePathFollower(path: Path2D, s = 0): PathFollower {
  return {
    path,
    s,
    v: 0,
    closed: false,
    length: path.length,
    setTargetS: vi.fn(),
    clearTarget: vi.fn(),
    setLeader: vi.fn(),
    setSpacingMode: vi.fn(),
    setSpeedCap: vi.fn(),
    update: vi.fn(),
    object: {
      getWorldPosition: vi.fn((out: any) => { out.x = 5; out.y = 0; out.z = 5; return out; }),
    },
  } as unknown as PathFollower;
}

function makePath(pts: Array<{ x: number; z: number }>): Path2D {
  return {
    length: 100,
    closed: false,
    project: (p: { x: number; z: number }) => {
      // Compute actual closest point on each polyline segment
      let bestDist = Infinity;
      let bestS = 0;
      for (let i = 0; i < pts.length - 1; i++) {
        const ax = pts[i].x, az = pts[i].z;
        const bx = pts[i + 1].x, bz = pts[i + 1].z;
        const abx = bx - ax, abz = bz - az;
        const ab2 = abx * abx + abz * abz || 1e-6;
        const apx = p.x - ax, apz = p.z - az;
        let t = (apx * abx + apz * abz) / ab2;
        t = Math.max(0, Math.min(1, t));
        const px = ax + t * abx, pz = az + t * abz;
        const dist = Math.hypot(p.x - px, p.z - pz);
        if (dist < bestDist) {
          bestDist = dist;
          bestS = i * 10 + t * 10;
        }
      }
      return { s: bestS, dist: bestDist, t: { x: 1, z: 0 } };
    },
    sample: () => ({ p: { x: 0, z: 0 }, t: { x: 1, z: 0 } }),
    curvature: () => 0,
  } as unknown as Path2D;
}

describe('issueMoveOrder_does_not_switch_to_disconnected_path', () => {
  it('setTargetOnCurrentPath stays on the current path and returns true when target is close', () => {
    const path0 = makePath([{ x: 0, z: 0 }, { x: 50, z: 0 }]);
    const path1 = makePath([{ x: 0, z: 100 }, { x: 50, z: 100 }]); // far away

    const follower = makePathFollower(path0);
    const entry: FollowerEntry = {
      id: 1,
      follower,
      object: {} as any,
      mesh: {} as any,
      type: VehicleType.FIRETRUCK,
      offroadTarget: null,
    };

    // Target is very close to path0 (z=0), far from path1 (z=100)
    const ok = setTargetOnCurrentPath(entry, [path0, path1], { x: 20, z: 1 }, 12);

    expect(ok).toBe(true);
    // Follower's path should NOT have changed
    expect(entry.follower.path).toBe(path0);
    // setTargetS should have been called
    expect(follower.setTargetS).toHaveBeenCalled();
  });

  it('setTargetOnCurrentPath returns false when target is too far from current path', () => {
    const path0 = makePath([{ x: 0, z: 0 }, { x: 50, z: 0 }]);

    const follower = makePathFollower(path0);
    const entry: FollowerEntry = {
      id: 2,
      follower,
      object: {} as any,
      mesh: {} as any,
      type: VehicleType.FIRETRUCK,
      offroadTarget: null,
    };

    // Target is z=50, far from this path (z=0 line), maxRoadDistance=12
    const ok = setTargetOnCurrentPath(entry, [path0], { x: 20, z: 50 }, 12);

    expect(ok).toBe(false);
    // Follower's path should NOT have changed
    expect(entry.follower.path).toBe(path0);
    expect(follower.setTargetS).not.toHaveBeenCalled();
  });

  it('setTargetOnCurrentPath returns false when follower is not on any known path', () => {
    const path0 = makePath([{ x: 0, z: 0 }, { x: 50, z: 0 }]);
    const path1 = makePath([{ x: 0, z: 10 }, { x: 50, z: 10 }]);

    // Follower is on path0, but path0 is not in the provided list
    const follower = makePathFollower(path0);
    const entry: FollowerEntry = {
      id: 3,
      follower,
      object: {} as any,
      mesh: {} as any,
      type: VehicleType.FIRETRUCK,
      offroadTarget: null,
    };

    const ok = setTargetOnCurrentPath(entry, [path1], { x: 20, z: 10 }, 12);
    expect(ok).toBe(false);
    expect(follower.setTargetS).not.toHaveBeenCalled();
  });

  it('issueMoveOrder routes bulldozers off-road instead of projecting to path', () => {
    const path0 = makePath([{ x: 0, z: 0 }, { x: 50, z: 0 }]);
    const follower = makePathFollower(path0);
    const entry: FollowerEntry = {
      id: 4,
      follower,
      object: {} as any,
      mesh: {} as any,
      type: VehicleType.BULLDOZER,
      offroadTarget: null,
    };

    issueMoveOrder(entry, [path0], new Vector3(25, 0, 25));

    expect(entry.offroadTarget).not.toBeNull();
    expect(follower.clearTarget).toHaveBeenCalled();
    expect(follower.setTargetS).not.toHaveBeenCalled();
  });
});
