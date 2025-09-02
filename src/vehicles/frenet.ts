import { Matrix4, Object3D, Quaternion, Vector3 } from 'three';
import type { Heightmap } from '../terrain/heightmap';
import { Path2D, V2 } from '../paths/path2d';

function terrainNormal(hm: Heightmap, wx: number, wz: number) {
  const eps = hm.scale * 0.35;
  const hL = hm.sample(wx - eps, wz);
  const hR = hm.sample(wx + eps, wz);
  const hD = hm.sample(wx, wz - eps);
  const hU = hm.sample(wx, wz + eps);
  const Hx = (hR - hL) / (2 * eps);
  const Hz = (hU - hD) / (2 * eps);
  const n = new Vector3(-Hx, 1, -Hz);
  n.normalize();
  return n;
}

export class PathFollower {
  path: Path2D;
  hm: Heightmap;
  object: Object3D;
  s = 0;
  v = 0;
  // leader coupling (optional)
  private leaderS: number | undefined;
  private leaderV: number | undefined;
  // tuning
  Lmin = 3; Lmax = 14; kLook = 0.7;
  accel = 8; brake = 12;
  aLatMax = 5; vMaxClamp = 10; arriveDist = 6;
  laneOffset = 0;
  minGap = 2.0; timeHeadway = 1.0; // following gaps
  spacingMode: 'hybrid' | 'gap' | 'time' = 'hybrid';
  // smoothing
  prevQuat = new Quaternion();
  // external speed cap (e.g., intersections)
  private extCap = Infinity;
  private extCapTimer = 0;

  constructor(path: Path2D, hm: Heightmap, object: Object3D, s0 = 0) {
    this.path = path; this.hm = hm; this.object = object; this.s = s0;
    this.snapToPath();
  }

  setLeader(leaderS?: number, leaderV?: number) {
    this.leaderS = leaderS;
    this.leaderV = leaderV;
  }

  setSpacingMode(mode: 'hybrid' | 'gap' | 'time') { this.spacingMode = mode; }
  setFollowingParams(minGap: number, timeHeadway: number) {
    this.minGap = Math.max(0, minGap);
    this.timeHeadway = Math.max(0.1, timeHeadway);
  }

  private groundFrame(tanXZ: V2, n: Vector3) {
    const t = new Vector3(tanXZ.x, 0, tanXZ.z).normalize();
    // project t to be orthonormal to n
    t.sub(n.clone().multiplyScalar(t.dot(n))).normalize();
    const r = new Vector3().crossVectors(t, n).normalize();
    return { t, n, r };
  }

  private snapToPath() {
    const { p, t } = this.path.sample(this.s);
    const y = this.hm.sample(p.x, p.z);
    const n = terrainNormal(this.hm, p.x, p.z);
    const frame = this.groundFrame(t, n);
    const lane = frame.r.clone().multiplyScalar(this.laneOffset);
    const pos = new Vector3(p.x, y, p.z).add(lane);
    const m = new Matrix4().makeBasis(frame.r, n, frame.t);
    this.object.matrix.copy(m);
    this.object.matrix.setPosition(pos);
    this.object.matrixAutoUpdate = false;
    this.prevQuat.setFromRotationMatrix(this.object.matrix);
  }

  update(dt: number) {
    // For closed paths, wrap S; for open, clamp at end
    if (this.path.closed) {
      if (this.s >= this.path.length) this.s -= this.path.length;
      if (this.s < 0) this.s += this.path.length;
    } else {
      if (this.s >= this.path.length) return;
    }
    const L = Math.min(this.Lmax, Math.max(this.Lmin, this.Lmin + this.kLook * this.v));
    const sampL = this.path.sample(this.s + L);
    const target = sampL.p;
    const pos = new Vector3(); this.object.matrix.decompose(pos, new Quaternion(), new Vector3());
    const toT = { x: target.x - pos.x, z: target.z - pos.z } as V2;
    const distT = Math.hypot(toT.x, toT.z) || 1;
    const dirT = { x: toT.x / distT, z: toT.z / distT } as V2;
    // current forward from matrix column Z
    const fwd = new Vector3(); this.object.matrix.extractBasis(new Vector3(), new Vector3(), fwd);
    const fwdXZ = { x: fwd.x, z: fwd.z } as V2;
    const cross = fwdXZ.x * dirT.z - fwdXZ.z * dirT.x;
    const dot = fwdXZ.x * dirT.x + fwdXZ.z * dirT.z;
    const headingErr = Math.atan2(cross, dot);

    // curvature and speed target
    // curvature ahead: sample a few points to anticipate sharp turns
    const samples = [0, Math.min(2, L * 0.33), Math.min(4, L * 0.66), Math.min(6, L)];
    let kappaMax = 0;
    for (const ds of samples) {
      const k = Math.abs(this.path.curvature(this.s + ds));
      if (k > kappaMax) kappaMax = k;
    }
    const vCurve = Math.sqrt(Math.max(0.1, this.aLatMax / Math.max(kappaMax, 1e-3)));
    const vArrive = this.path.closed ? this.vMaxClamp : ((this.path.length - this.s < this.arriveDist) ? 2 : this.vMaxClamp);
    let vTarget = Math.min(this.vMaxClamp, vCurve, vArrive);

    // hard slow for near-90° bends within short distance
    const dTurn = 2.0; // meters ahead to evaluate
    const tNow = this.path.sample(this.s).t;
    const tNear = this.path.sample(this.s + dTurn).t;
    const dotTN = Math.max(-1, Math.min(1, tNow.x * tNear.x + tNow.z * tNear.z));
    const ang = Math.acos(dotTN); // radians
    if (ang > Math.PI * 0.80) { // > 144° extremely sharp: nearly stop
      vTarget = Math.min(vTarget, 0.15);
    } else if (ang > Math.PI * 0.5) { // > 90° very sharp: crawl
      vTarget = Math.min(vTarget, 0.45);
    } else if (ang > Math.PI * 0.35) { // > 63°: slow
      vTarget = Math.min(vTarget, 0.9);
    }

    // grade-based modulation (downhill a bit faster, uphill slower)
    const ahead = this.path.sample(this.s + 3.0).p;
    const now = this.path.sample(this.s).p;
    const hNow = this.hm.sample(now.x, now.z);
    const hAhead = this.hm.sample(ahead.x, ahead.z);
    const dist = Math.max(0.1, Math.hypot(ahead.x - now.x, ahead.z - now.z));
    const grade = (hAhead - hNow) / dist; // +uphill, -downhill
    const upFactor = 1 / (1 + Math.max(0, grade) * 1.2);
    const downFactor = 1 + Math.max(0, -grade) * 0.6;
    const gradeFactor = Math.max(0.5, Math.min(1.35, upFactor * downFactor));
    vTarget *= gradeFactor;
    // external cap
    if (this.extCapTimer > 0) {
      this.extCapTimer -= dt;
      vTarget = Math.min(vTarget, this.extCap);
    } else {
      this.extCap = Infinity;
    }
    // Leader following: cap target speed based on gap
    if (this.leaderS != null && this.leaderS > this.s) {
      const gapS = this.leaderS - this.s;
      const desiredGap = this.spacingMode === 'gap' ? this.minGap
        : this.spacingMode === 'time' ? Math.max(0, this.v * this.timeHeadway)
        : Math.max(this.minGap, this.v * this.timeHeadway);
      // Convert remaining gap to an upper-bound speed. If using pure gap, divide by a small reaction window.
      const denom = (this.spacingMode === 'gap') ? 0.3 : this.timeHeadway;
      const followSpeed = Math.max(0, (gapS - desiredGap) / Math.max(0.1, denom));
      vTarget = Math.min(vTarget, followSpeed);
    }
    // accel/brake
    const dv = vTarget - this.v;
    const maxUp = this.accel * dt, maxDown = this.brake * dt;
    const dvClamped = Math.max(-maxDown, Math.min(maxUp, dv));
    this.v += dvClamped;

    // advance along path
    let ds = Math.max(0, this.v * Math.cos(headingErr)) * dt;
    if (this.leaderS != null && this.leaderS > this.s) {
      const desiredGap = this.spacingMode === 'gap' ? this.minGap
        : this.spacingMode === 'time' ? Math.max(0, this.v * this.timeHeadway)
        : Math.max(this.minGap, this.v * this.timeHeadway);
      ds = Math.min(ds, Math.max(0, (this.leaderS - this.s) - desiredGap));
    }
    this.s = this.s + ds;
    if (this.path.closed) {
      if (this.s >= this.path.length) this.s -= this.path.length;
    } else {
      this.s = Math.min(this.path.length, this.s);
    }

    // update pose at new s
    const { p, t } = this.path.sample(this.s);
    const y = this.hm.sample(p.x, p.z);
    const n = terrainNormal(this.hm, p.x, p.z);
    const frame = this.groundFrame(t, n);
    const lane = frame.r.clone().multiplyScalar(this.laneOffset);
    const newPos = new Vector3(p.x, y, p.z).add(lane);
    const m = new Matrix4().makeBasis(frame.r, n, frame.t);
    // rotate around Y by a bounded amount toward headingErr
    const turnGain = 2.2;
    const yawRate = Math.max(-2.5, Math.min(2.5, turnGain * headingErr));
    const rotY = new Matrix4().makeRotationY(yawRate * dt);
    m.multiply(rotY);
    this.object.matrix.copy(m);
    this.object.matrix.setPosition(newPos);
  }

  // Apply an external speed cap for a duration (seconds)
  setSpeedCap(cap: number, duration: number) {
    this.extCap = Math.max(0, cap);
    this.extCapTimer = Math.max(this.extCapTimer, duration);
  }
}
