import { ArrowHelper, Color, Group, InstancedMesh, Matrix4, MeshStandardMaterial, Object3D, Quaternion, Vector3 } from 'three';
import { BoxGeometry } from 'three';
import type { Heightmap } from '../terrain/heightmap';
import type { RoadMask } from '../roads/state';
import type { RoadsVisual } from '../roads/visual';
import type { TerrainCost } from '../roads/cost';
import { aStarPath } from '../roads/astar';

type GridPoint = { x: number; z: number };

type Agent = {
  pos: Vector3;
  prevPos?: Vector3;
  grid: GridPoint; // current nearest grid cell
  path: GridPoint[];
  pathIdx: number;
  speedTilesPerSec: number; // tiles/sec
  // Road-follow state
  autoFollowRoad: boolean;
  prev?: GridPoint; // previous grid cell when following road
  // Midline projection hint/state
  pin?: { pathIndex: number; segIndex?: number };
  lastProj?: { normal: Vector3; tangent: Vector3 };
  prevTan?: Vector3;
  debug?: {
    yawMode: string;
    usedProj: boolean;
    fwd: { x: number; y: number; z: number };
    up: { x: number; y: number; z: number };
    right: { x: number; y: number; z: number };
    pinPath?: number;
    pinSeg?: number;
    lastTan?: { x: number; y: number; z: number };
    terrN?: { x: number; y: number; z: number };
    pathIdx: number;
    grid: { x: number; z: number };
    pos: { x: number; y: number; z: number };
    note?: string;
  };
  prevQuat?: Quaternion;
};

export class VehiclesManager {
  public group = new Group();
  private hm: Heightmap;
  private roadMask: RoadMask;
  private terrain: TerrainCost;
  private maxAgents: number;
  private agents: Agent[] = [];
  private inst: InstancedMesh;
  private instVane: InstancedMesh;
  private tmpObj = new Object3D();
  private tmpObj2 = new Object3D();
  private cellSize: number; // hm.scale
  private roadsVis?: RoadsVisual;
  private yawMode: 'grid' | 'midline' | 'velocity' | 'lookahead' = 'midline';
  private speedCurviness = 0.6; // weight for curvature speed reduction
  private speedMinFactor = 0.45;
  private spacingRadius = 0.7; // in world units (meters)
  private yawDebugOn = false;
  private yawDebugIndex = 0;
  private yawArrow?: ArrowHelper;
  private lastDt = 0;
  private smoothYaw = true;

  constructor(hm: Heightmap, terrain: TerrainCost, roadMask: RoadMask, maxAgents = 64, roadsVis?: RoadsVisual) {
    this.hm = hm; this.terrain = terrain; this.roadMask = roadMask; this.maxAgents = maxAgents;
    this.cellSize = hm.scale;
    this.roadsVis = roadsVis;
    const geo = new BoxGeometry(this.cellSize * 0.6, this.cellSize * 0.3, this.cellSize * 0.9);
    const mat = new MeshStandardMaterial({ color: new Color(0x1e90ff), roughness: 0.7, metalness: 0.1, emissive: new Color(0x0a1a2a), emissiveIntensity: 0.2 });
    this.inst = new InstancedMesh(geo, mat, maxAgents);
    this.inst.instanceMatrix.setUsage(35048); // DynamicDrawUsage
    // InstancedMesh uses a single bounding volume; disable frustum culling to avoid missing off-center instances
    this.inst.frustumCulled = false;
    this.inst.castShadow = true;
    this.inst.receiveShadow = false;
    this.group.add(this.inst);

    // Heading indicator (weathervane) above vehicle for debugging orientation
    const vaneGeo = new BoxGeometry(this.cellSize * 0.12, this.cellSize * 0.28, this.cellSize * 0.12);
    const vaneMat = new MeshStandardMaterial({ color: new Color(0xff4444), roughness: 0.8, metalness: 0.0, emissive: new Color(0x220000), emissiveIntensity: 0.3 });
    this.instVane = new InstancedMesh(vaneGeo, vaneMat, maxAgents);
    this.instVane.instanceMatrix.setUsage(35048);
    this.instVane.frustumCulled = false;
    this.instVane.castShadow = false;
    this.instVane.receiveShadow = false;
    this.group.add(this.instVane);
  }

  get count() { return this.agents.length; }

  spawnAt(gx: number, gz: number) {
    if (this.agents.length >= this.maxAgents) return;
    gx = clamp(Math.round(gx), 0, this.hm.width - 1);
    gz = clamp(Math.round(gz), 0, this.hm.height - 1);
    const wx = (gx + 0.5) * this.cellSize;
    const wz = (gz + 0.5) * this.cellSize;
    const y = this.hm.sample(wx, wz);
    const pos = new Vector3(wx, y + 0.2, wz);
    // If roads exist, snap spawn to nearest road tile
    const spawnCell = this.findNearestRoad(gx, gz) ?? { x: gx, z: gz };
    const wx2 = (spawnCell.x + 0.5) * this.cellSize;
    const wz2 = (spawnCell.z + 0.5) * this.cellSize;
    const y2 = this.hm.sample(wx2, wz2);
    const pos2 = new Vector3(wx2, y2 + 0.22, wz2);
    const agent: Agent = { pos: pos2, grid: spawnCell, path: [], pathIdx: 0, speedTilesPerSec: 3.2, autoFollowRoad: true };
    agent.prevPos = pos2.clone();
    // Initialize pin to nearest visual road path for midline projection (if available)
    if (this.roadsVis) {
      const idx = this.roadsVis.findNearestPathIndex(pos2.x, pos2.z);
      if (idx >= 0) agent.pin = { pathIndex: idx };
    }
    // Initialize a next step along the road if possible
    const next = this.chooseNextRoadNeighbor(agent.grid, agent.prev);
    if (next) { agent.path = [agent.grid, next]; agent.pathIdx = 0; agent.prev = agent.grid; }
    this.agents.push(agent);
    this.syncInstance(this.agents.length - 1);
    this.inst.instanceMatrix.needsUpdate = true;
  }

  setYawMode(mode: 'grid' | 'midline' | 'velocity' | 'lookahead') { this.yawMode = mode; }
  setYawDebug(on: boolean) {
    this.yawDebugOn = on;
    if (on) {
      if (!this.yawArrow) {
        this.yawArrow = new ArrowHelper(new Vector3(1, 0, 0), new Vector3(0, 0, 0), this.cellSize * 1.2, 0xff0000);
        this.group.add(this.yawArrow);
      }
    } else {
      if (this.yawArrow) { this.group.remove(this.yawArrow); this.yawArrow = undefined; }
    }
  }
  setYawSmoothing(on: boolean) { this.smoothYaw = on; }
  getDebugText(i = 0): string {
    const a = this.agents[i];
    if (!a || !a.debug) return 'no agent/debug';
    const d = a.debug;
    const v = (o?: {x:number;y:number;z:number}) => o ? `${o.x.toFixed(3)},${o.y.toFixed(3)},${o.z.toFixed(3)}` : 'n/a';
    return [
      `yawMode=${d.yawMode} usedProj=${d.usedProj}`,
      `pos=(${v(d.pos)}) grid=(${d.grid.x},${d.grid.z}) pathIdx=${d.pathIdx}`,
      `fwd=(${v(d.fwd)}) up=(${v(d.up)}) right=(${v(d.right)})`,
      `terrN=(${v(d.terrN)}) lastTan=(${v(d.lastTan)}) pinPath=${d.pinPath ?? 'n/a'} pinSeg=${d.pinSeg ?? 'n/a'}`,
      d.note ?? ''
    ].join('\n');
  }

  clear() {
    this.agents.length = 0;
    this.inst.count = 0 as any;
    this.inst.instanceMatrix.needsUpdate = true;
  }

  // Plan path for one or all agents to a destination grid cell
  setDestinationAll(gx: number, gz: number) {
    for (let i = 0; i < this.agents.length; i++) this.setDestination(i, gx, gz);
  }

  setDestination(i: number, gx: number, gz: number) {
    const a = this.agents[i];
    if (!a) return;
    a.autoFollowRoad = false; // explicit destination switches to path mode
    gx = clamp(Math.round(gx), 0, this.hm.width - 1);
    gz = clamp(Math.round(gz), 0, this.hm.height - 1);
    const W = this.terrain.width;
    const H = this.terrain.height;
    // Snap start and goal to nearest road cells
    const startRoad = this.findNearestRoad(a.grid.x, a.grid.z);
    const goalRoad = this.findNearestRoad(gx, gz);
    if (!startRoad || !goalRoad) return; // no roads to use
    // If agent wasn't exactly on a road tile, snap its logical grid and position to the road
    if (startRoad.x !== a.grid.x || startRoad.z !== a.grid.z) {
      a.grid = { x: startRoad.x, z: startRoad.z };
      const wx = (a.grid.x + 0.5) * this.cellSize;
      const wz = (a.grid.z + 0.5) * this.cellSize;
      a.pos.set(wx, this.hm.sample(wx, wz) + 0.2, wz);
    }
    const field = {
      width: W,
      height: H,
      costAt: (x: number, z: number, _step?: { dx: number; dz: number }, _prev?: { dx: number; dz: number }) => {
        // Strictly constrain to road tiles
        return this.roadMask.mask[z * W + x] === 1 ? 1 : Infinity;
      }
    };
    const path = aStarPath(field as any, startRoad, goalRoad, { diag: true, heuristic: 'euclid', maxIter: W * H * 6 });
    if (path.length) { a.path = path; a.pathIdx = 0; a.prev = undefined; }
  }

  update(dt: number) {
    this.lastDt = dt;
    const s = this.cellSize;
    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i];
      // Ensure we have a target segment: for road-follow, keep extending along road
    if (a.autoFollowRoad && a.path.length - 1 <= a.pathIdx) {
      const next = this.chooseNextRoadNeighbor(a.grid, a.prev);
      if (next) {
        a.path = [a.grid, next];
        a.pathIdx = 0;
        a.prev = { ...a.grid };
      }
    }

      if (a.path.length - 1 > a.pathIdx) {
        // Speed modulation by curvature (based on projected tangent change)
        let speedFactor = 1.0;
        if (a.lastProj?.tangent && a.prevTan) {
          const t0 = a.prevTan.clone().normalize();
          const t1 = a.lastProj.tangent.clone().normalize();
          const dot = Math.max(-1, Math.min(1, t0.x * t1.x + t0.z * t1.z));
          const curv = 1 - Math.abs(dot); // 0 straight, 1 sharp
          speedFactor = Math.max(this.speedMinFactor, 1 - this.speedCurviness * curv);
        }
        // Simple spacing: brake if another agent is close ahead
        if (this.agents.length > 1) {
          for (let j = 0; j < this.agents.length; j++) if (j !== i) {
            const b = this.agents[j];
            const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
            const d2 = dx*dx + dz*dz;
            if (d2 < this.spacingRadius * this.spacingRadius) {
              // ahead check (based on current forward estimate)
              const hintCur = a.path[a.pathIdx];
              const hintNxt = a.path[a.pathIdx + 1];
              const nx = (hintNxt.x + 0.5) * s, nz = (hintNxt.z + 0.5) * s;
              const fdx = nx - a.pos.x, fdz = nz - a.pos.z;
              const fl = Math.hypot(fdx, fdz) || 1;
              const ahead = (dx * (fdx / fl) + dz * (fdz / fl)) > 0;
              if (ahead) { speedFactor = Math.min(speedFactor, 0.5); }
            }
          }
        }
        let remainStep = a.speedTilesPerSec * dt * s * speedFactor;
        while (remainStep > 1e-6 && a.pathIdx < a.path.length - 1) {
          const nxt = a.path[a.pathIdx + 1];
          const nxtPos = new Vector3((nxt.x + 0.5) * s, this.hm.sample((nxt.x + 0.5) * s, (nxt.z + 0.5) * s), (nxt.z + 0.5) * s);
          const toNext = new Vector3().subVectors(nxtPos, a.pos);
          const remain = Math.max(1e-6, toNext.length());
          if (remainStep >= remain) {
            a.prev = { ...a.grid };
            a.grid = { x: nxt.x, z: nxt.z };
            a.pos.copy(nxtPos).y += 0.18;
            a.pathIdx++;
            remainStep -= remain;
          } else {
            a.pos.addScaledVector(toNext.normalize(), remainStep);
            a.pos.y = this.hm.sample(a.pos.x, a.pos.z) + 0.18;
            remainStep = 0;
          }
        }
      }

      // Midline projection: snap to visual road and capture tangent/normal for pose
      a.lastProj = undefined;
      if (this.roadsVis) {
        let pIdx = a.pin?.pathIndex;
        if (pIdx == null || pIdx < 0) {
          const idx = this.roadsVis.findNearestPathIndex(a.pos.x, a.pos.z);
          if (idx >= 0) { a.pin = { pathIndex: idx }; pIdx = idx; }
        }
        if (pIdx != null && pIdx >= 0) {
          const res = this.roadsVis.projectToMidlineOnPath(pIdx, a.pos.x, a.pos.z, a.pin?.segIndex, 96);
          if (res) {
            // Use projection for orientation only; keep integrated position to avoid fighting movement
            a.lastProj = { normal: res.normal, tangent: res.tangent };
            if (!a.pin) a.pin = { pathIndex: pIdx };
            a.pin.segIndex = res.segIndex;
            // Gentle lateral stickiness toward midline (XZ only)
            const lateral = new Vector3(res.pos.x - a.pos.x, 0, res.pos.z - a.pos.z);
            const alpha = 1.2; // m/s toward centerline
            const maxNudge = alpha * this.lastDt;
            const len = lateral.length();
            if (len > 1e-6) {
              lateral.multiplyScalar(Math.min(1, maxNudge / len));
              a.pos.add(lateral);
              a.pos.y = this.hm.sample(a.pos.x, a.pos.z) + 0.18;
            }
          }
        }
      }
      this.syncInstance(i);
      // Track previous state for next frame
      if (a.lastProj?.tangent) a.prevTan = a.lastProj.tangent.clone();
      a.prevPos = a.pos.clone();
    }
    this.inst.instanceMatrix.needsUpdate = true;
    this.instVane.instanceMatrix.needsUpdate = true;
  }

  private syncInstance(i: number) {
    const a = this.agents[i];
    this.tmpObj.position.copy(a.pos);
    // Build oriented basis aligned to terrain normal and movement direction
    const up = a.lastProj?.normal ?? this.terrainNormal(a.pos.x, a.pos.z);
    let fwd = new Vector3(0, 0, 1);
    // Helper to set path segment direction
    const setPathDir = () => {
      if (a.path.length - 1 > a.pathIdx) {
        const cur = a.path[a.pathIdx];
        const nxt = a.path[a.pathIdx + 1];
        fwd.set(nxt.x - cur.x, 0, nxt.z - cur.z);
        return true;
      }
      return false;
    };
    // Choose forward vector with robust fallbacks per mode
    if (this.yawMode === 'midline') {
      if (a.lastProj?.tangent) fwd.copy(a.lastProj.tangent);
      else if (!setPathDir()) {
        if (a.prevPos) fwd.set(a.pos.x - a.prevPos.x, 0, a.pos.z - a.prevPos.z);
      }
    } else if (this.yawMode === 'grid') {
      if (!setPathDir()) {
        if (a.lastProj?.tangent) fwd.copy(a.lastProj.tangent);
        else if (a.prevPos) fwd.set(a.pos.x - a.prevPos.x, 0, a.pos.z - a.prevPos.z);
      }
    } else if (this.yawMode === 'velocity') {
      if (a.prevPos) fwd.set(a.pos.x - a.prevPos.x, 0, a.pos.z - a.prevPos.z);
      if (fwd.lengthSq() < 1e-8) {
        if (a.lastProj?.tangent) fwd.copy(a.lastProj.tangent);
        else setPathDir();
      }
    } else if (this.yawMode === 'lookahead') {
      if (a.path.length - 1 > a.pathIdx) {
        const cur = a.path[a.pathIdx];
        const nxt = a.path[Math.min(a.pathIdx + 1, a.path.length - 1)];
        const nxt2 = a.path[Math.min(a.pathIdx + 2, a.path.length - 1)];
        const dx1 = (nxt.x - cur.x), dz1 = (nxt.z - cur.z);
        const dx2 = (nxt2.x - nxt.x), dz2 = (nxt2.z - nxt.z);
        fwd.set(dx1 + 0.7 * dx2, 0, dz1 + 0.7 * dz2);
      }
      if (fwd.lengthSq() < 1e-8) {
        if (a.lastProj?.tangent) fwd.copy(a.lastProj.tangent);
        else if (!setPathDir() && a.prevPos) fwd.set(a.pos.x - a.prevPos.x, 0, a.pos.z - a.prevPos.z);
      }
    }
    const fwdPreLen = Math.sqrt(fwd.lengthSq());
    if (fwdPreLen < 1e-12) fwd.set(0, 0, 1);
    fwd.normalize();
    // Project forward onto terrain plane
    const right = new Vector3().crossVectors(fwd, up);
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
    right.normalize();
    fwd = new Vector3().crossVectors(up, right).normalize();
    // Target orientation quaternion and smoothing (slerp)
    const m = new Matrix4().makeBasis(right, up, fwd);
    const targetQ = new Quaternion().setFromRotationMatrix(m);
    const tau = 0.12; // seconds
    const alpha = this.smoothYaw ? (1 - Math.exp(-(this.lastDt || 0) / tau)) : 1;
    if (!a.prevQuat) a.prevQuat = targetQ.clone();
    a.prevQuat.slerp(targetQ, alpha);
    // Capture debug snapshot
    const copy = (v: Vector3) => ({ x: +v.x.toFixed(6), y: +v.y.toFixed(6), z: +v.z.toFixed(6) });
    const showDir = new Vector3(0, 0, 1).applyQuaternion(a.prevQuat);
    const yawDeg = Math.atan2(showDir.x, showDir.z) * 180 / Math.PI;
    const tanDot = a.lastProj?.tangent ? (a.lastProj.tangent.x * showDir.x + a.lastProj.tangent.z * showDir.z) : undefined;
    a.debug = {
      yawMode: this.yawMode,
      usedProj: !!a.lastProj,
      fwd: copy(showDir),
      up: copy(up),
      right: copy(right),
      pinPath: a.pin?.pathIndex,
      pinSeg: a.pin?.segIndex,
      lastTan: a.lastProj ? copy(a.lastProj.tangent) : undefined,
      terrN: copy(this.terrainNormal(a.pos.x, a.pos.z)),
      pathIdx: a.pathIdx,
      grid: { x: a.grid.x, z: a.grid.z },
      pos: { x: +a.pos.x.toFixed(3), y: +a.pos.y.toFixed(3), z: +a.pos.z.toFixed(3) },
      note: `fwdPreLen=${fwdPreLen.toFixed(5)} rightLen=${Math.sqrt(right.lengthSq()).toFixed(5)} yawDeg=${yawDeg.toFixed(1)} tanDot=${tanDot!=null?tanDot.toFixed(3):'n/a'}`,
    };

    // Construct rotation matrix columns (right, up, forward)
    this.tmpObj.quaternion.copy(a.prevQuat);
    this.tmpObj.updateMatrix();
    this.inst.setMatrixAt(i, this.tmpObj.matrix as Matrix4);
    this.inst.count = Math.max(this.inst.count as any as number, i + 1) as any;

    // Vane: place a small marker above and slightly ahead to visualize yaw clearly
    this.tmpObj2.position
      .copy(a.pos)
      .addScaledVector(up, this.cellSize * 0.35)
      .addScaledVector(fwd, this.cellSize * 0.4);
    this.tmpObj2.quaternion.copy(this.tmpObj.quaternion);
    this.tmpObj2.scale.set(0.6, 1.0, 0.6);
    this.tmpObj2.updateMatrix();
    this.instVane.setMatrixAt(i, this.tmpObj2.matrix as Matrix4);
    this.instVane.count = Math.max(this.instVane.count as any as number, i + 1) as any;

    // Update debug arrow for one agent if enabled
    if (this.yawDebugOn && this.yawArrow && i === this.yawDebugIndex) {
      const pos = a.pos.clone().addScaledVector(up, this.cellSize * 0.6);
      this.yawArrow.position.copy(pos);
      const dir = new Vector3(0, 0, 1).applyQuaternion(a.prevQuat);
      this.yawArrow.setDirection(new Vector3(dir.x, 0, dir.z).normalize());
      this.yawArrow.setLength(this.cellSize * 1.5);
    }
  }

  private terrainNormal(wx: number, wz: number): Vector3 {
    const e = this.cellSize * 0.5;
    const hL = this.hm.sample(wx - e, wz);
    const hR = this.hm.sample(wx + e, wz);
    const hD = this.hm.sample(wx, wz - e);
    const hU = this.hm.sample(wx, wz + e);
    const dhdx = (hR - hL) / (2 * e);
    const dhdz = (hU - hD) / (2 * e);
    const n = new Vector3(-dhdx, 1, -dhdz);
    n.normalize();
    return n;
  }

  private chooseNextRoadNeighbor(cur: GridPoint, prev?: GridPoint): GridPoint | undefined {
    const W = this.terrain.width, H = this.terrain.height;
    const x = cur.x, z = cur.z;
    const neigh4: GridPoint[] = [];
    const neigh8: GridPoint[] = [];
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dz) continue;
      const nx = x + dx, nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue;
      if (this.roadMask.mask[nz * W + nx] !== 1) continue;
      if (prev && nx === prev.x && nz === prev.z) continue;
      const isDiag = dx !== 0 && dz !== 0;
      (isDiag ? neigh8 : neigh4).push({ x: nx, z: nz });
    }
    const neigh = neigh4.length ? neigh4 : neigh8;
    if (!neigh.length) {
      // dead end: allow going back if prev exists
      if (prev) return { x: prev.x, z: prev.z };
      return undefined;
    }
    if (neigh.length === 1) return neigh[0];
    // If we don't have a previous direction, choose the neighbor with the strongest continuation (highest road degree)
    const roadDegree = (cx: number, cz: number, ex?: number, ez?: number) => {
      let d = 0;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const nx = cx + dx, nz = cz + dz;
        if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue;
        if (ex != null && ez != null && nx === ex && nz === ez) continue;
        if (this.roadMask.mask[nz * W + nx] === 1) d++;
      }
      return d;
    };
    if (!prev) {
      let bestN: GridPoint | undefined;
      let bestD = -1;
      for (const n of neigh) {
        const d = roadDegree(n.x, n.z, x, z);
        if (d > bestD) { bestD = d; bestN = n; }
      }
      if (bestN) return bestN;
    }
    // Otherwise, prefer least turning angle relative to incoming vector
    let best: GridPoint | undefined;
    let bestScore = -Infinity;
    let vx = 0, vz = 1;
    if (prev) { vx = x - prev.x; vz = z - prev.z; }
    for (const n of neigh) {
      const dx = n.x - x, dz = n.z - z;
      const dot = (dx * vx + dz * vz) / (Math.hypot(dx, dz) * Math.hypot(vx, vz) || 1);
      const score = dot; // larger is straighter
      if (score > bestScore) { bestScore = score; best = n; }
    }
    return best;
  }

  private findNearestRoad(gx: number, gz: number): GridPoint | undefined {
    const W = this.terrain.width, H = this.terrain.height;
    if (this.roadMask.mask[gz * W + gx] === 1) return { x: gx, z: gz };
    const maxR = Math.max(W, H);
    for (let r = 1; r < maxR; r++) {
      for (let dz = -r; dz <= r; dz++) {
        const nz = gz + dz; if (nz < 0 || nz >= H) continue;
        const nx1 = gx - r; if (nx1 >= 0 && nx1 < W && this.roadMask.mask[nz * W + nx1] === 1) return { x: nx1, z: nz };
        const nx2 = gx + r; if (nx2 >= 0 && nx2 < W && this.roadMask.mask[nz * W + nx2] === 1) return { x: nx2, z: nz };
      }
      for (let dx = -r + 1; dx <= r - 1; dx++) {
        const nx = gx + dx; if (nx < 0 || nx >= W) continue;
        const nz1 = gz - r; if (nz1 >= 0 && nz1 < H && this.roadMask.mask[nz1 * W + nx] === 1) return { x: nx, z: nz1 };
        const nz2 = gz + r; if (nz2 >= 0 && nz2 < H && this.roadMask.mask[nz2 * W + nx] === 1) return { x: nx, z: nz2 };
      }
    }
    return undefined;
  }
}

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }
