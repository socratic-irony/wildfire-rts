import type { Path2D } from '../paths/path2d';

export type Follower = {
  path: Path2D;
  s: number;              // arc-length along path (meters)
  v: number;              // current speed (m/s)
  setSpeedCap?: (cap:number, dur:number)=>void; // external cap
};

type Approach = {
  pathIndex: number;
  interId: number;
  stopS: number;        // where to stop (s on path)
  detectS: number;      // where approach begins (s on path)
};

type QueueItem = { idx: number; distToStop: number };

export class IntersectionManager {
  private roadsVis: any;
  private pathIndexMap: Map<Path2D, number>;
  private approaches: Array<Array<Approach>> = [];
  private arrivalTimes: Map<number, number> = new Map(); // followerIdx -> time at stop
  private readonly params = {
    dDetect: 14,       // start approach behavior closer so we don't crawl too early
    stopBack: 2.0,
    stopEps: 0.2,
    tMinStop: 0.5,
    nearDist: 2.0,
    dwellCap: 0.0,
    dwellPulse: 0.15,
    brakeDecel: 3.0,   // m/s^2 comfortable braking
    brakePulse: 0.12,  // seconds for braking caps
    exitPassDist: 3.0,
    interTimeout: 3.0,
  };
  private reservations = new Map<number, { by: number; startS: number; startTime: number }>();

  constructor(roadsVis: any, pathIndexMap: Map<Path2D, number>) {
    this.roadsVis = roadsVis;
    this.pathIndexMap = pathIndexMap;
    this.buildApproaches();
  }

  private wrapDist(len: number, from: number, to: number, closed: boolean) {
    let d = to - from;
    if (closed) {
      if (d < 0) d += len;
    }
    return d;
  }

  private buildApproaches() {
    const appro: Array<Array<Approach>> = [];
    // For each path, create approaches for each intersection on that path
    this.pathIndexMap.forEach((pIdx) => {
      const ints = this.roadsVis.getIntersectionsForPath(pIdx) || [];
      const L = this.roadsVis.getPathLength(pIdx) || 0;
      const closed = this.roadsVis.isPathClosed(pIdx);
      for (const inter of ints) {
        const stopS = (inter.s - this.params.stopBack + (closed ? L : 0)) % (L || 1);
        const detectS = (inter.s - this.params.dDetect + (closed ? L : 0)) % (L || 1);
        const a: Approach = { pathIndex: pIdx, interId: inter.id, stopS, detectS };
        if (!appro[inter.id]) appro[inter.id] = [];
        appro[inter.id].push(a);
      }
    });
    this.approaches = appro;
  }

  // Determine distance along path from s to target considering wrap
  private distAhead(pIdx: number, s: number, target: number) {
    const L = this.roadsVis.getPathLength(pIdx) || 0;
    const closed = this.roadsVis.isPathClosed(pIdx);
    let d = target - s;
    if (closed) { if (d < 0) d += L; }
    return d;
  }

  update(dt: number, followers: Follower[]) {
    const now = performance.now() / 1000;
    // For each intersection, build queues per approach (front-most vehicle first)
    for (let interId = 0; interId < this.approaches.length; interId++) {
      const approaches = this.approaches[interId];
      if (!approaches || !approaches.length) continue;
      const queues: QueueItem[][] = approaches.map(() => []);
      // assign followers to queues
      for (let fi = 0; fi < followers.length; fi++) {
        const f = followers[fi];
        const pIdx = this.pathIndexMap.get(f.path) ?? -1;
        if (pIdx < 0) continue;
        const ai = approaches.findIndex(a => a.pathIndex === pIdx);
        if (ai < 0) continue;
        const a = approaches[ai];
        const L = this.roadsVis.getPathLength(pIdx) || 0;
        const closed = this.roadsVis.isPathClosed(pIdx);
        const dDetect = this.distAhead(pIdx, f.s, a.detectS);
        const dStop = this.distAhead(pIdx, f.s, a.stopS);
        if (dDetect <= this.params.dDetect + 1e-3) {
          // within approach zone
          queues[ai].push({ idx: fi, distToStop: dStop });
        }
      }
      // sort queues by distance to stop (smallest first)
      for (const q of queues) q.sort((u, v) => u.distToStop - v.distToStop);

      // gather candidates (front of each non-empty queue)
      type Cand = { idx:number; approachIdx:number; arrival:number; distToStop:number };
      const cands: Cand[] = [];
      for (let ai = 0; ai < queues.length; ai++) {
        const q = queues[ai];
        if (!q.length) continue;
        const front = q[0];
        const f = followers[front.idx];
        // update arrival time when stopped near the line
        if (front.distToStop < this.params.nearDist && f.v < this.params.stopEps) {
          if (!this.arrivalTimes.has(front.idx)) this.arrivalTimes.set(front.idx, now);
        }
        const arrival = this.arrivalTimes.get(front.idx) ?? Infinity;
        // only candidates that either already stopped or are front-of-queue
        cands.push({ idx: front.idx, approachIdx: ai, arrival, distToStop: front.distToStop });
      }
      // sort by arrival (earlier first), then by approach index, then follower index
      cands.sort((a,b) => (a.arrival - b.arrival) || (a.approachIdx - b.approachIdx) || (a.idx - b.idx));

      // reservation logic: grant to the best candidate that meets min stop
      // and keep others capped at stop if they reached the line
      const current = this.reservations.get(interId);
      // Release if holder is gone or timed out will be handled below by main loop using PASS_DIST logic.
      let grantedIdx: number | undefined;
      if (!current && cands.length) {
        for (const c of cands) {
          if (c.arrival !== Infinity && (now - c.arrival) >= this.params.tMinStop) {
            const a = approaches[c.approachIdx];
            // grant
            this.reservations.set(interId, { by: c.idx, startS: a.stopS, startTime: now });
            grantedIdx = c.idx;
            break;
          }
        }
      } else if (current) {
        grantedIdx = current.by;
      }

      // Apply controls: cap non-granted fronts near the stop; allow granted to go
      for (let ai = 0; ai < queues.length; ai++) {
        const q = queues[ai]; if (!q.length) continue;
        const front = q[0];
        const f = followers[front.idx];
        const isGranted = grantedIdx === front.idx;
        const dist = front.distToStop;
        if (isGranted) {
          // clear arrival record so we don't get stuck next time
          this.arrivalTimes.delete(front.idx);
          // no cap here; vehicle proceeds
        } else {
          // approach and stop caps (dynamic braking instead of hard crawl far away)
          if (dist < this.params.nearDist) {
            f.setSpeedCap?.(this.params.dwellCap, this.params.dwellPulse);
          } else {
            // compute braking cap so we can still stop at the line: v <= sqrt(2 * a * dist)
            const vBrake = Math.sqrt(Math.max(0, 2 * this.params.brakeDecel * Math.max(0, dist - 0.3)));
            // apply a brief cap; manager runs each frame so this updates continuously
            f.setSpeedCap?.(vBrake, this.params.brakePulse);
          }
        }
      }

      // Release reservation when holder passes intersection by margin or timeout
      if (current) {
        const holder = followers[current.by];
        const ai = approaches.findIndex(a => a.pathIndex === (this.pathIndexMap.get(holder.path) ?? -1));
        if (ai >= 0) {
          const a = approaches[ai];
          const L = this.roadsVis.getPathLength(a.pathIndex) || 0;
          const closed = this.roadsVis.isPathClosed(a.pathIndex);
          let ds = holder.s - a.stopS;
          if (closed && ds < 0) ds += L;
          if (ds > this.params.exitPassDist || (now - current.startTime) > this.params.interTimeout) {
            this.reservations.delete(interId);
          }
        } else {
          this.reservations.delete(interId);
        }
      }
    }
  }
}
