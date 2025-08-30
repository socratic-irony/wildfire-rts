import { Color, Group, InstancedMesh, Matrix4, MeshStandardMaterial, Object3D, Vector3 } from 'three';
import { BoxGeometry } from 'three';
import type { Heightmap } from '../terrain/heightmap';
import type { RoadMask } from '../roads/state';
import type { TerrainCost } from '../roads/cost';
import { aStarPath } from '../roads/astar';

type GridPoint = { x: number; z: number };

type Agent = {
  pos: Vector3;
  grid: GridPoint; // current nearest grid cell
  path: GridPoint[];
  pathIdx: number;
  speedTilesPerSec: number; // tiles/sec
  // Road-follow state
  autoFollowRoad: boolean;
  prev?: GridPoint; // previous grid cell when following road
};

export class VehiclesManager {
  public group = new Group();
  private hm: Heightmap;
  private roadMask: RoadMask;
  private terrain: TerrainCost;
  private maxAgents: number;
  private agents: Agent[] = [];
  private inst: InstancedMesh;
  private tmpObj = new Object3D();
  private cellSize: number; // hm.scale

  constructor(hm: Heightmap, terrain: TerrainCost, roadMask: RoadMask, maxAgents = 64) {
    this.hm = hm; this.terrain = terrain; this.roadMask = roadMask; this.maxAgents = maxAgents;
    this.cellSize = hm.scale;
    const geo = new BoxGeometry(this.cellSize * 0.6, this.cellSize * 0.3, this.cellSize * 0.9);
    const mat = new MeshStandardMaterial({ color: new Color(0x1e90ff), roughness: 0.7, metalness: 0.1, emissive: new Color(0x0a1a2a), emissiveIntensity: 0.2 });
    this.inst = new InstancedMesh(geo, mat, maxAgents);
    this.inst.instanceMatrix.setUsage(35048); // DynamicDrawUsage
    // InstancedMesh uses a single bounding volume; disable frustum culling to avoid missing off-center instances
    this.inst.frustumCulled = false;
    this.inst.castShadow = true;
    this.inst.receiveShadow = false;
    this.group.add(this.inst);
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
    // Initialize a next step along the road if possible
    const next = this.chooseNextRoadNeighbor(agent.grid, agent.prev);
    if (next) { agent.path = [agent.grid, next]; agent.pathIdx = 0; agent.prev = agent.grid; }
    this.agents.push(agent);
    this.syncInstance(this.agents.length - 1);
    this.inst.instanceMatrix.needsUpdate = true;
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
        const cur = a.path[a.pathIdx];
        const nxt = a.path[a.pathIdx + 1];
        const curPos = new Vector3((cur.x + 0.5) * s, this.hm.sample((cur.x + 0.5) * s, (cur.z + 0.5) * s), (cur.z + 0.5) * s);
        const nxtPos = new Vector3((nxt.x + 0.5) * s, this.hm.sample((nxt.x + 0.5) * s, (nxt.z + 0.5) * s), (nxt.z + 0.5) * s);
        const dir = new Vector3().subVectors(nxtPos, curPos);
        const dist = Math.max(1e-6, dir.length());
        const step = a.speedTilesPerSec * dt * s;
        if (step >= dist) {
          a.prev = { ...a.grid };
          a.grid = { x: nxt.x, z: nxt.z };
          a.pos.copy(nxtPos).y += 0.18;
          a.pathIdx++;
        } else {
          dir.normalize();
          a.pos.addScaledVector(dir, step);
          a.pos.y = this.hm.sample(a.pos.x, a.pos.z) + 0.18;
        }
      }
      this.syncInstance(i);
    }
    this.inst.instanceMatrix.needsUpdate = true;
  }

  private syncInstance(i: number) {
    const a = this.agents[i];
    this.tmpObj.position.copy(a.pos);
    // Build oriented basis aligned to terrain normal and movement direction
    const up = this.terrainNormal(a.pos.x, a.pos.z);
    let fwd = new Vector3(0, 0, 1);
    if (a.path.length - 1 > a.pathIdx) {
      const cur = a.path[a.pathIdx];
      const nxt = a.path[a.pathIdx + 1];
      const dx = (nxt.x - cur.x) * this.cellSize;
      const dz = (nxt.z - cur.z) * this.cellSize;
      fwd.set(dx, 0, dz).normalize();
    }
    // Project forward onto terrain plane
    const right = new Vector3().crossVectors(fwd, up);
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
    right.normalize();
    fwd = new Vector3().crossVectors(up, right).normalize();
    // Construct rotation matrix columns (right, up, forward)
    const m = new Matrix4();
    m.makeBasis(right, up, fwd);
    this.tmpObj.quaternion.setFromRotationMatrix(m);
    this.tmpObj.updateMatrix();
    this.inst.setMatrixAt(i, this.tmpObj.matrix as Matrix4);
    this.inst.count = Math.max(this.inst.count as any as number, i + 1) as any;
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
    const neigh: GridPoint[] = [];
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dz) continue;
      const nx = x + dx, nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue;
      if (this.roadMask.mask[nz * W + nx] === 1) {
        if (!prev || nx !== prev.x || nz !== prev.z) neigh.push({ x: nx, z: nz });
      }
    }
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
