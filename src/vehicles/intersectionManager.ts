import type { Path2D } from '../paths/path2d';
import type { PathFollower } from './frenet';

export type IntersectionInfo = {
  id: number;
  s: number;
  pos: { x: number; z: number };
};

type PathEntry = {
  path: Path2D;
  intersections: IntersectionInfo[];
  lookup: Map<number, IntersectionInfo>;
};

type QueueEntry = {
  follower: PathFollower;
  ready: boolean;
  arrivalSeq?: number;
};

type IntersectionState = {
  queue: QueueEntry[];
  occupant?: PathFollower;
};

type FollowerState = {
  intersectionId?: number;
  waitElapsed: number;
  hasStopped: boolean;
};

export class IntersectionManager {
  private pathEntries = new Map<Path2D, PathEntry>();
  private intersectionStates = new Map<number, IntersectionState>();
  private followerStates: WeakMap<PathFollower, FollowerState> = new WeakMap();
  private arrivalCounter = 0;

  // Tuning constants (meters / seconds)
  private approachDistance = 10;
  private stopDistance = 1.5;
  private clearDistance = 4;
  private minStopTime = 1.0;
  private stopSpeedThreshold = 0.18;
  private approachMaxSpeed = 6;
  private creepSpeed = 0.6;
  private crossingSpeed = 4;

  setPaths(entries: Array<{ path: Path2D; intersections: IntersectionInfo[] }>) {
    this.pathEntries.clear();
    this.intersectionStates.clear();
    const seenIds = new Set<number>();
    for (const { path, intersections } of entries) {
      const sorted = [...intersections].sort((a, b) => a.s - b.s);
      const lookup = new Map<number, IntersectionInfo>();
      for (const info of sorted) {
        lookup.set(info.id, info);
        seenIds.add(info.id);
      }
      this.pathEntries.set(path, { path, intersections: sorted, lookup });
    }
    for (const id of seenIds) this.intersectionStates.set(id, { queue: [] });
    this.followerStates = new WeakMap();
    this.arrivalCounter = 0;
  }

  clearFollowers() {
    for (const state of this.intersectionStates.values()) {
      state.queue.length = 0;
      state.occupant = undefined;
    }
    this.followerStates = new WeakMap();
  }

  preUpdateFollower(follower: PathFollower, path: Path2D, dt: number) {
    const entry = this.pathEntries.get(path);
    const followerState = this.ensureFollowerState(follower);
    if (!entry || !entry.intersections.length) {
      this.releaseFollower(follower);
      return;
    }

    let info = followerState.intersectionId != null ? entry.lookup.get(followerState.intersectionId) : undefined;
    if (!info) {
      const next = this.findNextIntersection(entry, path, follower.s);
      if (!next || next.dist > this.approachDistance) {
        this.releaseFollower(follower);
        return;
      }
      info = next.info;
      followerState.intersectionId = info.id;
      followerState.waitElapsed = 0;
      followerState.hasStopped = false;
    }

    const state = this.getIntersectionState(info.id);
    this.pruneState(state, info.id);

    const distAhead = this.distanceAhead(path, follower.s, info.s);
    const distPast = this.distancePast(path, follower.s, info.s);
    if (distPast >= this.clearDistance) {
      this.releaseFollower(follower);
      return;
    }

    if (state.occupant === follower) {
      follower.setSpeedCap(this.crossingSpeed, 0.25);
      followerState.waitElapsed = 0;
      followerState.hasStopped = false;
      return;
    }

    const queueEntry = this.ensureQueueEntry(state, follower);

    if (distAhead <= this.stopDistance) {
      follower.setSpeedCap(0, 0.3);
      if (follower.v < this.stopSpeedThreshold) {
        followerState.hasStopped = true;
        followerState.waitElapsed += dt;
        queueEntry.ready = true;
        if (queueEntry.arrivalSeq == null) queueEntry.arrivalSeq = this.arrivalCounter++;
      } else {
        followerState.waitElapsed = 0;
      }
      const front = this.getQueueFront(state);
      if (
        !state.occupant &&
        front &&
        front.follower === follower &&
        queueEntry.ready &&
        followerState.waitElapsed >= this.minStopTime
      ) {
        this.removeFromQueue(state, follower);
        state.occupant = follower;
        followerState.waitElapsed = 0;
        followerState.hasStopped = false;
        follower.setSpeedCap(this.crossingSpeed, 0.25);
      }
    } else {
      followerState.hasStopped = false;
      followerState.waitElapsed = 0;
      queueEntry.ready = false;
      const t = Math.max(0, Math.min(1, (distAhead - this.stopDistance) / Math.max(1e-3, this.approachDistance - this.stopDistance)));
      const cap = this.creepSpeed + (this.approachMaxSpeed - this.creepSpeed) * t;
      follower.setSpeedCap(cap, 0.25);
    }
  }

  postUpdateFollower(follower: PathFollower, path: Path2D) {
    const followerState = this.followerStates.get(follower);
    if (!followerState?.intersectionId) return;
    const entry = this.pathEntries.get(path);
    if (!entry) {
      this.releaseFollower(follower);
      return;
    }
    const info = entry.lookup.get(followerState.intersectionId);
    if (!info) {
      this.releaseFollower(follower);
      return;
    }
    const distPast = this.distancePast(path, follower.s, info.s);
    if (distPast >= this.clearDistance) this.releaseFollower(follower);
  }

  private ensureFollowerState(follower: PathFollower) {
    let state = this.followerStates.get(follower);
    if (!state) {
      state = { waitElapsed: 0, hasStopped: false };
      this.followerStates.set(follower, state);
    }
    return state;
  }

  private getIntersectionState(id: number) {
    let state = this.intersectionStates.get(id);
    if (!state) {
      state = { queue: [] };
      this.intersectionStates.set(id, state);
    }
    return state;
  }

  private pruneState(state: IntersectionState, id: number) {
    state.queue = state.queue.filter((entry) => this.followerStates.get(entry.follower)?.intersectionId === id);
    if (state.occupant && this.followerStates.get(state.occupant)?.intersectionId !== id) {
      state.occupant = undefined;
    }
  }

  private ensureQueueEntry(state: IntersectionState, follower: PathFollower) {
    let entry = state.queue.find((q) => q.follower === follower);
    if (!entry) {
      entry = { follower, ready: false };
      state.queue.push(entry);
    }
    return entry;
  }

  private getQueueFront(state: IntersectionState) {
    let best: QueueEntry | undefined;
    for (const entry of state.queue) {
      if (!entry.ready || entry.arrivalSeq == null) continue;
      if (!best || (best.arrivalSeq ?? Infinity) > entry.arrivalSeq) best = entry;
    }
    if (best) return best;
    let fallback: QueueEntry | undefined;
    for (const entry of state.queue) {
      const seq = entry.arrivalSeq ?? Infinity;
      if (!fallback || (fallback.arrivalSeq ?? Infinity) > seq) fallback = entry;
    }
    return fallback;
  }

  private removeFromQueue(state: IntersectionState, follower: PathFollower) {
    const idx = state.queue.findIndex((entry) => entry.follower === follower);
    if (idx >= 0) state.queue.splice(idx, 1);
  }

  private releaseFollower(follower: PathFollower) {
    const followerState = this.followerStates.get(follower);
    if (!followerState?.intersectionId) return;
    const state = this.intersectionStates.get(followerState.intersectionId);
    if (state) {
      this.removeFromQueue(state, follower);
      if (state.occupant === follower) state.occupant = undefined;
    }
    followerState.intersectionId = undefined;
    followerState.waitElapsed = 0;
    followerState.hasStopped = false;
  }

  private findNextIntersection(entry: PathEntry, path: Path2D, s: number) {
    let bestInfo: IntersectionInfo | undefined;
    let bestDist = Infinity;
    for (const info of entry.intersections) {
      let ds = info.s - s;
      if (path.closed) {
        if (ds < 0) ds += path.length;
      } else if (ds < 0) {
        continue;
      }
      if (ds < bestDist) {
        bestDist = ds;
        bestInfo = info;
      }
    }
    if (!bestInfo) return null;
    return { info: bestInfo, dist: bestDist } as const;
  }

  private distanceAhead(path: Path2D, from: number, to: number) {
    let ds = to - from;
    if (path.closed && ds < 0) ds += path.length;
    return Math.max(0, ds);
  }

  private distancePast(path: Path2D, from: number, to: number) {
    let ds = from - to;
    if (path.closed && ds < 0) ds += path.length;
    return Math.max(0, ds);
  }
}

