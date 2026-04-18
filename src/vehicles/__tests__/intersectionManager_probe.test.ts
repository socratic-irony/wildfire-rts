/**
 * Regression: IntersectionManager.canEnterProbe blocks entry when the
 * exit space is occupied by another follower.
 */

import { describe, it, expect, vi } from 'vitest';
import { IntersectionManager, IntersectionInfo } from '../intersectionManager';
import type { Path2D } from '../../paths/path2d';
import type { PathFollower } from '../frenet';

function makeFollower(s: number, path: Path2D): PathFollower {
  return {
    path,
    s,
    v: 0,
    setSpeedCap: vi.fn(),
    setLeader: vi.fn(),
    setSpacingMode: vi.fn(),
    update: vi.fn(),
    object: { getWorldPosition: vi.fn() },
  } as unknown as PathFollower;
}

function makePath(len = 100, closed = false): Path2D {
  return { length: len, closed } as unknown as Path2D;
}

describe('intersection_manager_blocks_entry_when_exit_is_occupied', () => {
  it('canEnterProbe returning false prevents occupant grant', () => {
    const path = makePath();
    const intersection: IntersectionInfo = { id: 1, s: 50, pos: { x: 5, z: 5 } };

    const mgr = new IntersectionManager();
    mgr.setPaths([{ path, intersections: [intersection] }]);

    // Always block entry
    mgr.setCanEnterProbe(() => false);

    const follower = makeFollower(40, path);
    // Simulate the follower approaching and completing stop sequence
    // We need to manually drive the state machine. Pre-update at stop distance.
    // After enough wait time the grant logic runs but canEnterProbe blocks it.

    // Drive the follower into approach range: s=40 is 10 units from intersection s=50
    // preUpdateFollower should cap speed. The occupant should remain unset.
    for (let i = 0; i < 30; i++) {
      mgr.preUpdateFollower(follower, path, 0.1);
      (follower as any).s = Math.min(48.5, (follower as any).s + 0.05);
      (follower as any).v = 0; // simulate stopped
      mgr.postUpdateFollower(follower, path);
    }

    // Verify occupant was not granted (canEnterProbe blocked it)
    // Access intersection state via the grant: if occupant had been set,
    // setSpeedCap would have been called with crossingSpeed (4).
    // Instead it should have been called with 0 (stop cap).
    const calls = (follower.setSpeedCap as ReturnType<typeof vi.fn>).mock.calls;
    const grantCalls = calls.filter(([speed]) => speed === 4);
    expect(grantCalls).toHaveLength(0);
  });

  it('canEnterProbe returning true allows occupant grant after stop time', () => {
    const path = makePath();
    const intersection: IntersectionInfo = { id: 2, s: 50, pos: { x: 5, z: 5 } };

    const mgr = new IntersectionManager();
    mgr.setPaths([{ path, intersections: [intersection] }]);

    // Always allow entry
    mgr.setCanEnterProbe(() => true);

    // s=48.6 → distAhead = 50 - 48.6 = 1.4 ≤ stopDistance (1.5), enters stop zone
    const follower = makeFollower(48.6, path);
    (follower as any).v = 0; // stopped

    // Drive enough ticks to accumulate minStopTime (1.0s): 11 × 0.1s
    for (let i = 0; i < 15; i++) {
      mgr.preUpdateFollower(follower, path, 0.1);
      mgr.postUpdateFollower(follower, path);
    }

    // With probe allowing entry and stop time met, setSpeedCap(4) should appear
    const calls = (follower.setSpeedCap as ReturnType<typeof vi.fn>).mock.calls;
    const grantCalls = calls.filter(([speed]) => speed === 4);
    expect(grantCalls.length).toBeGreaterThan(0);
  });

  it('setCanEnterProbe with no argument clears the probe (defaults to allow)', () => {
    const path = makePath();
    const intersection: IntersectionInfo = { id: 3, s: 50, pos: { x: 5, z: 5 } };

    const mgr = new IntersectionManager();
    mgr.setPaths([{ path, intersections: [intersection] }]);
    mgr.setCanEnterProbe(() => false); // block
    mgr.setCanEnterProbe(undefined);   // clear → should allow

    // s=48.6 → distAhead = 1.4 ≤ stopDistance (1.5)
    const follower = makeFollower(48.6, path);
    (follower as any).v = 0;

    for (let i = 0; i < 15; i++) {
      mgr.preUpdateFollower(follower, path, 0.1);
      mgr.postUpdateFollower(follower, path);
    }

    const calls = (follower.setSpeedCap as ReturnType<typeof vi.fn>).mock.calls;
    const grantCalls = calls.filter(([speed]) => speed === 4);
    expect(grantCalls.length).toBeGreaterThan(0);
  });
});
