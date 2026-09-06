import type { Path2D } from '../paths/path2d';
import { INTERSECTION_STOP_DISTANCE } from '../roads/trafficRules';
import type { PathFollower } from './frenet';
import type { TurnRoute, TurnMovement } from './turnRouting';

export type IntersectionInfo = {
  id: number;
  s: number;
  pos: { x: number; z: number };
};

export type TrafficPhase = 'cruising' | 'approaching' | 'queued' | 'entering' | 'crossing';

export type ControlledFollower = {
  id: number;
  follower: PathFollower;
  path: Path2D;
};

type PathEntry = {
  path: Path2D;
  intersections: IntersectionInfo[];
};

type QueueEntry = {
  id: number;
  follower: PathFollower;
  ready: boolean;
  stoppedAt: number | null;
};

type IntersectionState = {
  id: number;
  queue: QueueEntry[];
  occupant?: { id: number; follower: PathFollower };
};

type FollowerState = {
  id: number;
  intersectionId?: number;
  intersection?: IntersectionInfo;
  phase: TrafficPhase;
  waitElapsed: number;
  route?: TurnRoute;
};

export type IntersectionSnapshot = {
  intersections: Array<{
    id: number;
    queue: number[];
    occupantId: number | null;
  }>;
  followers: Array<{
    id: number;
    intersectionId: number | null;
    phase: TrafficPhase;
    waitElapsed: number;
    movement: TurnMovement | null;
  }>;
};

export class IntersectionManager {
  private pathEntries = new Map<Path2D, PathEntry>();
  private intersectionStates = new Map<number, IntersectionState>();
  private followerStates: WeakMap<PathFollower, FollowerState> = new WeakMap();
  private trackedFollowers = new Set<PathFollower>();
  private legacyIds: WeakMap<PathFollower, number> = new WeakMap();
  private nextLegacyId = 1_000_000;
  private time = 0;
  private canEnterProbe?: (follower: PathFollower, info: IntersectionInfo, route?: TurnRoute) => boolean;
  private turnRouter?: (follower: PathFollower, id: number, info: IntersectionInfo) => TurnRoute | null;
  private turnGranted?: (follower: PathFollower, id: number, route: TurnRoute) => void;

  // Tuning constants (world meters / seconds).
  private readonly approachDistance = 12;
  private readonly stopDistance = INTERSECTION_STOP_DISTANCE;
  private readonly stopTolerance = 0.25;
  private readonly clearDistance = 4;
  private readonly minStopTime = 1;
  private readonly stopSpeedThreshold = 0.18;
  private readonly approachMaxSpeed = 6;
  private readonly crossingSpeed = 4;

  /** Return false to keep a ready vehicle queued (for example, spillback). */
  setCanEnterProbe(fn?: (follower: PathFollower, info: IntersectionInfo, route?: TurnRoute) => boolean) {
    this.canEnterProbe = fn;
  }

  /**
   * Optional directed movement hook. A route is installed only when a queued
   * vehicle is granted entry, so denied vehicles never change paths.
   */
  setTurnRouter(fn?: (follower: PathFollower, id: number, info: IntersectionInfo) => TurnRoute | null) {
    this.turnRouter = fn;
  }

  setTurnGranted(fn?: (follower: PathFollower, id: number, route: TurnRoute) => void) {
    this.turnGranted = fn;
  }

  /** Register a directed continuation generated after a movement grant. */
  registerPath(path: Path2D, intersections: IntersectionInfo[]) {
    const unique: IntersectionInfo[] = [];
    for (const info of intersections) {
      if (!unique.some((entry) => entry.id === info.id && Math.abs(entry.s - info.s) <= 1e-4)) unique.push(info);
      if (!this.intersectionStates.has(info.id)) this.intersectionStates.set(info.id, { id: info.id, queue: [] });
    }
    unique.sort((a, b) => a.s - b.s);
    this.pathEntries.set(path, { path, intersections: unique });
  }

  setPaths(entries: Array<{ path: Path2D; intersections: IntersectionInfo[] }>) {
    this.pathEntries.clear();
    this.intersectionStates.clear();
    for (const { path, intersections } of entries) {
      const unique: IntersectionInfo[] = [];
      for (const info of intersections) {
        if (!unique.some((entry) => entry.id === info.id && Math.abs(entry.s - info.s) <= 1e-4)) {
          unique.push(info);
        }
        if (!this.intersectionStates.has(info.id)) {
          this.intersectionStates.set(info.id, { id: info.id, queue: [] });
        }
      }
      unique.sort((a, b) => a.s - b.s);
      this.pathEntries.set(path, { path, intersections: unique });
    }
    this.followerStates = new WeakMap();
    this.trackedFollowers.clear();
    this.legacyIds = new WeakMap();
    this.nextLegacyId = 1_000_000;
    this.time = 0;
  }

  clearFollowers() {
    for (const state of this.intersectionStates.values()) {
      state.queue.length = 0;
      state.occupant = undefined;
    }
    this.followerStates = new WeakMap();
    this.trackedFollowers.clear();
  }

  /**
   * Apply approach/queue caps to all road followers, then arbitrate grants as a
   * batch. Batch arbitration makes simultaneous arrivals independent of array
   * update order.
   */
  updateBeforeMovement(entries: ControlledFollower[], dt: number) {
    this.time += Math.max(0, dt);
    for (const entry of entries) this.prepareFollower(entry, dt);
    this.resolveReadyQueues();
  }

  /** Backwards-compatible single-follower entry point used by older callers. */
  preUpdateFollower(follower: PathFollower, path: Path2D, dt: number) {
    let id = this.legacyIds.get(follower);
    if (id == null) {
      id = this.nextLegacyId++;
      this.legacyIds.set(follower, id);
    }
    this.updateBeforeMovement([{ id, follower, path }], dt);
  }

  postUpdateFollower(follower: PathFollower, path: Path2D) {
    const followerState = this.followerStates.get(follower);
    if (followerState?.intersectionId == null) return;
    if (followerState.route?.path === path) {
      followerState.phase = 'crossing';
      if (follower.s >= followerState.route.clearS - 1e-3) this.releaseFollower(follower);
      return;
    }
    const entry = this.pathEntries.get(path);
    const info = entry ? followerState.intersection : undefined;
    if (!info) {
      this.releaseFollower(follower);
      return;
    }
    const signedToIntersection = this.signedDistance(path, follower.s, info.s);
    if (signedToIntersection <= 0) {
      followerState.phase = 'crossing';
      if (-signedToIntersection >= this.clearDistance) this.releaseFollower(follower);
    }
  }

  getFollowerPhase(follower: PathFollower): TrafficPhase {
    return this.followerStates.get(follower)?.phase ?? 'cruising';
  }

  getSnapshot(): IntersectionSnapshot {
    const intersections = [...this.intersectionStates.values()]
      .sort((a, b) => a.id - b.id)
      .map((state) => ({
        id: state.id,
        queue: [...state.queue]
          .sort(this.compareQueueEntries)
          .map((entry) => entry.id),
        occupantId: state.occupant?.id ?? null,
      }));
    const followers = [...this.trackedFollowers]
      .map((follower) => this.followerStates.get(follower))
      .filter((state): state is FollowerState => state != null)
      .sort((a, b) => a.id - b.id)
      .map((state) => ({
        id: state.id,
        intersectionId: state.intersectionId ?? null,
        phase: state.phase,
        waitElapsed: Number(state.waitElapsed.toFixed(3)),
        movement: state.route?.movement ?? null,
      }));
    return { intersections, followers };
  }

  private prepareFollower(entry: ControlledFollower, dt: number) {
    const { id, follower, path } = entry;
    const pathEntry = this.pathEntries.get(path);
    const followerState = this.ensureFollowerState(follower, id);
    this.trackedFollowers.add(follower);
    if (followerState.route?.path === path) {
      const state = this.getIntersectionState(followerState.route.intersectionId);
      if (state.occupant?.follower === follower) {
        followerState.phase = 'crossing';
        followerState.waitElapsed = 0;
        follower.setSpeedCap(this.crossingSpeed, this.capDuration(dt));
        return;
      }
      this.releaseFollower(follower);
    }
    if (!pathEntry || pathEntry.intersections.length === 0 || path.length <= 0) {
      this.releaseFollower(follower);
      return;
    }

    let info = followerState.intersectionId == null ? undefined : followerState.intersection;
    if (!info) {
      const next = this.findNextIntersection(pathEntry, path, follower.s);
      if (!next || next.dist > this.approachDistance) {
        this.releaseFollower(follower);
        return;
      }
      info = next.info;
      followerState.intersectionId = info.id;
      followerState.intersection = info;
      followerState.phase = 'approaching';
      followerState.waitElapsed = 0;
    }

    const state = this.getIntersectionState(info.id);
    this.pruneState(state, info.id);
    const signedToIntersection = this.signedDistance(path, follower.s, info.s);

    if (state.occupant?.follower === follower) {
      followerState.phase = signedToIntersection > 0 ? 'entering' : 'crossing';
      followerState.waitElapsed = 0;
      follower.setSpeedCap(this.crossingSpeed, this.capDuration(dt));
      return;
    }

    const queueEntry = this.ensureQueueEntry(state, follower, id);
    const distanceToStopLine = signedToIntersection - this.stopDistance;
    if (distanceToStopLine <= this.stopTolerance) {
      followerState.phase = 'queued';
      follower.setSpeedCap(0, this.capDuration(dt));
      if (follower.v < this.stopSpeedThreshold) {
        followerState.waitElapsed += Math.max(0, dt);
        queueEntry.ready = true;
        if (queueEntry.stoppedAt == null) queueEntry.stoppedAt = this.time;
      } else {
        followerState.waitElapsed = 0;
        queueEntry.ready = false;
        queueEntry.stoppedAt = null;
      }
      return;
    }

    followerState.phase = 'approaching';
    followerState.waitElapsed = 0;
    queueEntry.ready = false;
    queueEntry.stoppedAt = null;
    const brake = Math.max(0.1, follower.brake || 12);
    const brakingCap = Math.sqrt(2 * brake * Math.max(0, distanceToStopLine));
    follower.setSpeedCap(Math.min(this.approachMaxSpeed, brakingCap), this.capDuration(dt));
  }

  private resolveReadyQueues() {
    for (const state of this.intersectionStates.values()) {
      if (state.occupant) continue;
      const candidate = [...state.queue]
        .filter((entry) => {
          const followerState = this.followerStates.get(entry.follower);
          return entry.ready && followerState != null && followerState.waitElapsed >= this.minStopTime;
        })
        .sort(this.compareQueueEntries)[0];
      if (!candidate) continue;
      const followerState = this.followerStates.get(candidate.follower);
      const info = followerState?.intersection;
      const route = followerState && info ? (this.turnRouter?.(candidate.follower, candidate.id, info) ?? null) : null;
      if (!followerState || !info || !(this.canEnterProbe?.(candidate.follower, info, route ?? undefined) ?? true)) continue;

      this.removeFromQueue(state, candidate.follower);
      state.occupant = { id: candidate.id, follower: candidate.follower };
      if (route) {
        this.registerPath(route.continuationPath, route.continuationIntersections);
        this.turnGranted?.(candidate.follower, candidate.id, route);
        candidate.follower.path = route.path;
        candidate.follower.s = 0;
        candidate.follower.forcePathProgress = true;
        followerState.route = route;
      }
      followerState.phase = 'entering';
      followerState.waitElapsed = 0;
      candidate.follower.setSpeedCap(this.crossingSpeed, 0.25);
    }
  }

  private readonly compareQueueEntries = (a: QueueEntry, b: QueueEntry) => {
    const timeDelta = (a.stoppedAt ?? Infinity) - (b.stoppedAt ?? Infinity);
    return timeDelta || a.id - b.id;
  };

  private ensureFollowerState(follower: PathFollower, id: number) {
    let state = this.followerStates.get(follower);
    if (!state) {
      state = { id, phase: 'cruising', waitElapsed: 0 };
      this.followerStates.set(follower, state);
    } else {
      state.id = id;
    }
    return state;
  }

  private getIntersectionState(id: number) {
    let state = this.intersectionStates.get(id);
    if (!state) {
      state = { id, queue: [] };
      this.intersectionStates.set(id, state);
    }
    return state;
  }

  private pruneState(state: IntersectionState, id: number) {
    state.queue = state.queue.filter((entry) => this.followerStates.get(entry.follower)?.intersectionId === id);
    if (state.occupant && this.followerStates.get(state.occupant.follower)?.intersectionId !== id) {
      state.occupant = undefined;
    }
  }

  private ensureQueueEntry(state: IntersectionState, follower: PathFollower, id: number) {
    let entry = state.queue.find((queued) => queued.follower === follower);
    if (!entry) {
      entry = { id, follower, ready: false, stoppedAt: null };
      state.queue.push(entry);
    } else {
      entry.id = id;
    }
    return entry;
  }

  private removeFromQueue(state: IntersectionState, follower: PathFollower) {
    const index = state.queue.findIndex((entry) => entry.follower === follower);
    if (index >= 0) state.queue.splice(index, 1);
  }

  private releaseFollower(follower: PathFollower) {
    const followerState = this.followerStates.get(follower);
    if (!followerState) return;
    if (followerState.intersectionId != null) {
      const state = this.intersectionStates.get(followerState.intersectionId);
      if (state) {
        this.removeFromQueue(state, follower);
        if (state.occupant?.follower === follower) state.occupant = undefined;
      }
    }
    followerState.intersectionId = undefined;
    followerState.intersection = undefined;
    followerState.route = undefined;
    follower.forcePathProgress = false;
    followerState.phase = 'cruising';
    followerState.waitElapsed = 0;
  }

  private findNextIntersection(entry: PathEntry, path: Path2D, s: number) {
    let bestInfo: IntersectionInfo | undefined;
    let bestDist = Infinity;
    for (const info of entry.intersections) {
      const distance = this.forwardDistance(path, s, info.s);
      if (distance < bestDist) {
        bestDist = distance;
        bestInfo = info;
      }
    }
    return bestInfo ? { info: bestInfo, dist: bestDist } : null;
  }

  private forwardDistance(path: Path2D, from: number, to: number) {
    if (!path.closed) return to >= from ? to - from : Infinity;
    if (path.length <= 0) return Infinity;
    return ((to - from) % path.length + path.length) % path.length;
  }

  /** Signed shortest arc from follower position to intersection. */
  private signedDistance(path: Path2D, from: number, to: number) {
    if (!path.closed) return to - from;
    if (path.length <= 0) return 0;
    const half = path.length * 0.5;
    return ((to - from + half) % path.length + path.length) % path.length - half;
  }

  private capDuration(dt: number) {
    return Math.max(0.12, dt * 2.5);
  }
}
