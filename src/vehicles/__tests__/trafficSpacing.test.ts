import { describe, expect, it, vi } from 'vitest';
import type { Path2D } from '../../paths/path2d';
import type { PathFollower } from '../frenet';
import { assignPathLeaders } from '../trafficSpacing';

function followerAt(s: number) {
  return {
    s,
    v: 3,
    setLeader: vi.fn(),
  } as unknown as PathFollower;
}

describe('assignPathLeaders', () => {
  it('links the final follower to the first follower across a closed-loop seam', () => {
    const path = { closed: true, length: 100 } as Path2D;
    const nearStart = followerAt(2);
    const nearEnd = followerAt(90);

    assignPathLeaders(path, [nearEnd, nearStart]);

    expect(nearStart.setLeader).toHaveBeenLastCalledWith(90, 3);
    expect(nearEnd.setLeader).toHaveBeenLastCalledWith(102, 3);
  });

  it('leaves the final follower unbounded on an open path', () => {
    const path = { closed: false, length: 100 } as Path2D;
    const first = followerAt(2);
    const last = followerAt(90);

    assignPathLeaders(path, [last, first]);

    expect(first.setLeader).toHaveBeenLastCalledWith(90, 3);
    expect(last.setLeader).toHaveBeenLastCalledWith(undefined, undefined);
  });
});
