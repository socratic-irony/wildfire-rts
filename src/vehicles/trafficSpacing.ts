import type { Path2D } from '../paths/path2d';
import type { PathFollower } from './frenet';

/**
 * Assign the next vehicle on a path as each follower's leader. Closed paths use
 * a virtual leader position beyond path.length for the seam pair, so the final
 * follower cannot drive through the first one.
 */
export function assignPathLeaders(path: Path2D, followers: PathFollower[]) {
  if (followers.length === 0) return;
  followers.sort((a, b) => a.s - b.s);

  for (let i = 0; i < followers.length; i++) {
    const current = followers[i];
    const next = followers[i + 1];
    if (next) {
      current.setLeader(next.s, next.v);
      continue;
    }
    if (path.closed && followers.length > 1) {
      const first = followers[0];
      current.setLeader(first.s + path.length, first.v);
    } else {
      current.setLeader(undefined, undefined);
    }
  }
}
