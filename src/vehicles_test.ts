import { Object3D, Raycaster, Vector2, Vector3, Mesh, BoxGeometry, MeshStandardMaterial, Color } from 'three';
import { createRenderer, resizeRenderer } from './core/renderer';
import { createScene } from './core/scene';
import { createCameraRig, resizeCamera } from './core/camera';
import { Loop } from './core/loop';
import { generateHeightmap } from './terrain/heightmap';
import { createTerrainMaterial } from './terrain/material';
import { computeBiomes, applyBiomeVertexColors } from './terrain/biomes';
import { buildChunkedTerrain } from './terrain/chunks';
import { attachStats } from './ui/debug';
import { buildTerrainCost } from './roads/cost';
import { aStarPath } from './roads/astar';
import { RoadsVisual } from './roads/visual';
import { createRoadMask, rasterizePolyline, clearRoadMask } from './roads/state';
import { VehiclesManager } from './vehicles/vehicles';
import { Path2D } from './paths/path2d';
import { PathFollower } from './vehicles/frenet';
import { RTSOrbitCamera } from './core/rtsOrbit';
import { createForest } from './actors/trees';
import { createShrubs } from './actors/shrubs';

const app = document.getElementById('app')!;
const scene = createScene();
const rig = createCameraRig(app);
scene.add(rig.root);

const renderer = createRenderer(app);

// Small, mostly-flat map for vehicle/road tests
const hm = generateHeightmap(32, 32, 1, {
  seed: 42,
  frequency: 0.5,
  amplitude: 0.25,
  octaves: 2,
  persistence: 0.5,
});

const biomes = computeBiomes(hm);
const terrainMat = createTerrainMaterial() as any;
const chunked = buildChunkedTerrain(hm, terrainMat, 32);
scene.add(chunked.group);

const terrainObj = chunked.group as Object3D;
const orbit = new RTSOrbitCamera(
  renderer.domElement,
  rig.camera,
  terrainObj,
  (x, z) => hm.sample(x, z),
  new Vector3((hm.width * hm.scale) / 2, 0, (hm.height * hm.scale) / 2)
);

const loop = new Loop();
loop.add((dt) => {
  // simple WASD + arrows + QE/RF
  if (!(window as any)._wf_keys) {
    (window as any)._wf_keys = new Set<string>();
    window.addEventListener('keydown', (e) => (window as any)._wf_keys.add(e.key.toLowerCase()));
    window.addEventListener('keyup', (e) => (window as any)._wf_keys.delete(e.key.toLowerCase()));
    (window as any).keyDown = (k: string) => (window as any)._wf_keys.has(k);
  }
  const move = {
    left: (window as any).keyDown('a') || (window as any).keyDown('arrowleft'),
    right: (window as any).keyDown('d') || (window as any).keyDown('arrowright'),
    up: (window as any).keyDown('w') || (window as any).keyDown('arrowup'),
    down: (window as any).keyDown('s') || (window as any).keyDown('arrowdown'),
    yawL: (window as any).keyDown('q') || false,
    yawR: (window as any).keyDown('e') || false,
    tiltU: (window as any).keyDown('r') || false,
    tiltD: (window as any).keyDown('f') || false,
  };

  orbit.update(dt, move);
  const t = performance.now() / 1000;
  forest?.update(t);
  shrubs?.update(t);
  const camPos = rig.camera.getWorldPosition(new Vector3());
  chunked.updateLOD(camPos.x, camPos.z);
  if (followMode === 'grid') {
    vehicles.update(dt);
    if (yawDebugOn && yawDiv) yawDiv.textContent = vehicles.getDebugText(0);
  } else {
    // Update followers per path, front-to-back so leader uses up-to-date s
    const groups = new Map<Path2D, number[]>();
    for (let i = 0; i < followers.length; i++) {
      const p = followers[i].path as Path2D;
      if (!groups.has(p)) groups.set(p, []);
      groups.get(p)!.push(i);
    }
    for (const [, idxs] of groups) {
      idxs.sort((a, b) => followers[a].s - followers[b].s);
      for (let k = idxs.length - 1; k >= 0; k--) {
        const i = idxs[k];
        if (k === idxs.length - 1) {
          followers[i].setLeader(undefined, undefined);
        } else {
          const lead = idxs[k + 1];
          followers[i].setLeader(followers[lead].s, followers[lead].v);
        }
        followers[i].setSpacingMode(spacingMode);
        followers[i].update(dt);
      }
    }
  }
  renderer.render(scene, rig.camera);
  stats.update(dt, renderer);
});

// Toggle grid overlay (G)
window.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() === 'g') {
    const shader = (terrainMat as any).userData?.shader;
    if (shader) shader.uniforms.uGridEnabled.value = shader.uniforms.uGridEnabled.value ? 0 : 1;
  }
  if (e.key.toLowerCase() === 'y') {
    yawDebugOn = !yawDebugOn;
    vehicles.setYawDebug(yawDebugOn);
    if (yawDebugOn) {
      if (!yawDiv) {
        yawDiv = document.createElement('div');
        yawDiv.style.position = 'absolute';
        yawDiv.style.left = '12px';
        yawDiv.style.bottom = '12px';
        yawDiv.style.padding = '6px 8px';
        yawDiv.style.background = 'rgba(0,0,0,0.5)';
        yawDiv.style.color = '#e5e7eb';
        yawDiv.style.whiteSpace = 'pre';
        yawDiv.style.font = '12px/1.2 system-ui, sans-serif';
        app.appendChild(yawDiv);
      }
    } else {
      if (yawDiv && yawDiv.parentElement) { yawDiv.parentElement.removeChild(yawDiv); }
      yawDiv = null;
    }
  }
  if (e.key.toLowerCase() === 'l') {
    console.log(vehicles.getDebugText(0));
  }
});

// Vegetation (optional, low counts on small map)
const forest = createForest(hm, biomes);
scene.add(forest.leaves);
scene.add(forest.trunks);
const shrubs = createShrubs(hm, biomes);
scene.add(shrubs.inst);

const stats = attachStats(app, { chunkGroup: chunked.group, forest, shrubs });
loop.start();

function onResize() {
  resizeRenderer(renderer, app);
  resizeCamera(rig, app);
}
window.addEventListener('resize', onResize);
onResize();

// Roads and Vehicles
const roadCost = buildTerrainCost(hm);
const roadsVis = new RoadsVisual(hm);
scene.add(roadsVis.group);
const roadMask = createRoadMask(hm.width, hm.height);
let roadsEnabled = false;
let roadEndpoints: Array<{ x: number; z: number }> = [];

const vehicles = new VehiclesManager(hm, roadCost, roadMask, 64, roadsVis);
scene.add(vehicles.group);
let vehiclesMoveEnabled = false;
let yawDebugOn = false;
let yawDiv: HTMLDivElement | null = null;

type FollowMode = 'grid' | 'frenet';
let followMode: FollowMode = 'frenet';
let path2ds: Path2D[] = [];
let followers: PathFollower[] = [];
vehicles.group.visible = (followMode === 'grid');

function rebuildPath2Ds() {
  const raw = roadsVis.getMidlinesXZ();
  const stitched: Array<Array<{x:number; z:number}>> = [];
  const used = new Array(raw.length).fill(false);
  const eps = hm.scale * 0.6;
  const near = (a:{x:number;z:number}, b:{x:number;z:number}) => Math.hypot(a.x-b.x, a.z-b.z) <= eps;
  for (let i = 0; i < raw.length; i++) {
    if (used[i] || raw[i].length < 2) continue;
    let cur = raw[i].slice(); used[i] = true;
    let extended = true;
    while (extended) {
      extended = false;
      for (let j = 0; j < raw.length; j++) {
        if (used[j] || raw[j].length < 2) continue;
        const a0 = cur[0], a1 = cur[cur.length-1];
        const b0 = raw[j][0], b1 = raw[j][raw[j].length-1];
        if (near(a1, b0)) { cur = cur.concat(raw[j].slice(1)); used[j] = true; extended = true; }
        else if (near(a1, b1)) { cur = cur.concat(raw[j].slice(0, raw[j].length-1).reverse()); used[j] = true; extended = true; }
        else if (near(a0, b1)) { cur = raw[j].concat(cur.slice(1)); used[j] = true; extended = true; }
        else if (near(a0, b0)) { cur = raw[j].slice().reverse().concat(cur.slice(1)); used[j] = true; extended = true; }
      }
    }
    stitched.push(cur);
  }
  // any leftovers
  for (let i = 0; i < raw.length; i++) if (!used[i]) stitched.push(raw[i]);
  path2ds = stitched.map(pts => new Path2D(pts));
}

function clearFollowers() {
  for (const f of followers) scene.remove(f.object);
  followers = [];
}

function spawnFollowerAtCamera() {
  if (!path2ds.length) return;
  const camPos = rig.camera.getWorldPosition(new Vector3());
  const start = { x: camPos.x, z: camPos.z };
  let bestIdx = 0, bestDist = Infinity, bestS = 0;
  for (let i = 0; i < path2ds.length; i++) {
    const proj = path2ds[i].project(start);
    if (proj.dist < bestDist) { bestDist = proj.dist; bestS = proj.s; bestIdx = i; }
  }
  // Visible follower: simple box like grid vehicles
  const obj = new Object3D();
  const geo = new BoxGeometry(hm.scale * 0.6, hm.scale * 0.3, hm.scale * 0.9);
  const mat = new MeshStandardMaterial({ color: new Color(0x1e90ff), roughness: 0.7, metalness: 0.1 });
  const mesh = new Mesh(geo, mat);
  mesh.castShadow = true;
  obj.add(mesh);
  scene.add(obj);
  const follower = new PathFollower(path2ds[bestIdx], hm, obj, bestS);
  followers.push(follower);
}

// Click handling for roads and vehicles
{
  const ray = new Raycaster();
  const mouse = new Vector2();
  const dom = renderer.domElement;
  const ndcFromClient = (cx: number, cy: number) => {
    const rect = dom.getBoundingClientRect();
    mouse.x = ((cx - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((cy - rect.top) / rect.height) * 2 + 1;
  };
  dom.addEventListener('click', (e) => {
    ndcFromClient(e.clientX, e.clientY);
    mouse.set(mouse.x, mouse.y);
    ray.setFromCamera(mouse as any, rig.camera);
    const hits = ray.intersectObject(chunked.group, true);
    if (!hits.length) return;
    const p = hits[0].point;
    const gx = Math.max(0, Math.min(hm.width - 1, Math.round(p.x / hm.scale)));
    const gz = Math.max(0, Math.min(hm.height - 1, Math.round(p.z / hm.scale)));
    if (roadsEnabled) {
      roadEndpoints.push({ x: gx, z: gz });
      if (roadEndpoints.length >= 2) {
        const [a, b] = [roadEndpoints[roadEndpoints.length - 2], roadEndpoints[roadEndpoints.length - 1]];
        const WE = 0.6, WS = 2.0, WV = 0.8;
        const SLOPE_MAX_TAN = 0.7;
        const CURV_W = 1.6;
        const costField = {
          width: roadCost.width,
          height: roadCost.height,
          costAt: (x: number, z: number, stepDir: { dx: number; dz: number }, prevDir?: { dx: number; dz: number }) => {
            const i = z * roadCost.width + x;
            const base = 1 + WE * roadCost.elev[i] + WS * roadCost.slope[i] - WV * roadCost.valley[i];
            if (roadCost.slope[i] > SLOPE_MAX_TAN) return Infinity;
            let curv = 0;
            if (prevDir && (prevDir.dx || prevDir.dz)) {
              const pvLen = Math.hypot(prevDir.dx, prevDir.dz) || 1;
              const stLen = Math.hypot(stepDir.dx, stepDir.dz) || 1;
              const pdx = prevDir.dx / pvLen, pdz = prevDir.dz / pvLen;
              const sdx = stepDir.dx / stLen, sdz = stepDir.dz / stLen;
              const dot = Math.max(-1, Math.min(1, pdx * sdx + pdz * sdz));
              curv = CURV_W * (1 - Math.max(0, dot));
            }
            return Math.max(0.05, base + curv);
          }
        };
        const path = aStarPath(costField as any, a, b, { diag: true, heuristic: 'euclid', maxIter: roadCost.width * roadCost.height * 6 });
        if (path.length) {
          roadsVis.addPath(path);
          rasterizePolyline(roadMask, path, 0.9);
          rebuildPath2Ds();
        }
      }
      return;
    }
    if (vehiclesMoveEnabled && followMode === 'grid') {
      vehicles.setDestinationAll(gx, gz);
      return;
    }
  });

  stats.setActions({
    setVizMode: () => {},
    roads: {
      toggle: (on) => { roadsEnabled = on; if (!on) roadEndpoints = []; },
      clear: () => { roadsVis.clear(); clearRoadMask(roadMask); roadEndpoints = []; },
    },
    vehicles: {
      spawn: () => {
        if (followMode === 'grid') {
          const camPos = rig.camera.getWorldPosition(new Vector3());
          const gx = Math.max(0, Math.min(hm.width - 1, Math.round(camPos.x / hm.scale)));
          const gz = Math.max(0, Math.min(hm.height - 1, Math.round(camPos.z / hm.scale)));
          vehicles.spawnAt(gx, gz);
        } else {
          spawnFollowerAtCamera();
        }
      },
      moveModeToggle: (on) => { vehiclesMoveEnabled = on; },
      clear: () => { vehicles.clear(); clearFollowers(); },
      toggleYawSmoothing: (on) => vehicles.setYawSmoothing(on),
      setSpacingMode: (m: 'hybrid' | 'gap' | 'time') => { spacingMode = m; },
      setFollowMode: (m: FollowMode) => {
        followMode = m;
        if (followMode === 'grid') {
          vehicles.group.visible = true;
          followers.forEach(f => f.object.visible = false);
        } else {
          vehicles.group.visible = false;
          rebuildPath2Ds();
          followers.forEach(f => f.object.visible = true);
        }
      },
      toggleYawDebug: (on) => {
        yawDebugOn = on;
        vehicles.setYawDebug(on);
        if (on) {
          if (!yawDiv) {
            yawDiv = document.createElement('div');
            yawDiv.style.position = 'absolute';
            yawDiv.style.left = '12px';
            yawDiv.style.bottom = '12px';
            yawDiv.style.padding = '6px 8px';
            yawDiv.style.background = 'rgba(0,0,0,0.5)';
            yawDiv.style.color = '#e5e7eb';
            yawDiv.style.whiteSpace = 'pre';
            yawDiv.style.font = '12px/1.2 system-ui, sans-serif';
            app.appendChild(yawDiv);
          }
        } else {
          if (yawDiv && yawDiv.parentElement) { yawDiv.parentElement.removeChild(yawDiv); }
          yawDiv = null;
        }
      },
    },
    preset: { set: (v) => seedVariant(v) }
  });
}

// Presets: Loop / Figure-8
type Variant = 'loop' | 'figure8';
function buildRectLoop(x0: number, z0: number, x1: number, z1: number) {
  const pts: Array<{ x: number; z: number }> = [];
  for (let x = x0; x <= x1; x++) pts.push({ x, z: z0 });
  for (let z = z0 + 1; z <= z1; z++) pts.push({ x: x1, z });
  for (let x = x1 - 1; x >= x0; x--) pts.push({ x, z: z1 });
  for (let z = z1 - 1; z > z0; z--) pts.push({ x: x0, z });
  return pts;
}
function buildFigure8(cx: number, cz: number, rx: number, rz: number) {
  const top = buildRectLoop(cx - rx, cz - 2 - rz, cx + rx, cz - 2 + rz);
  const bot = buildRectLoop(cx - rx, cz + 2 - rz, cx + rx, cz + 2 + rz);
  const bridge = [ { x: cx, z: cz - 2 }, { x: cx, z: cz - 1 }, { x: cx, z: cz }, { x: cx, z: cz + 1 }, { x: cx, z: cz + 2 } ];
  return [top, bridge, bot];
}
function seedVariant(variant: Variant) {
  roadsVis.clear();
  clearRoadMask(roadMask);
  vehicles.clear();
  clearFollowers();
  const pad = 6;
  if (variant === 'loop') {
    const loopPath = buildRectLoop(pad, pad, hm.width - 1 - pad, hm.height - 1 - pad);
    // Close visual loop by repeating start at end
    const closed = loopPath.concat([loopPath[0]]);
    roadsVis.addPath(closed);
    rasterizePolyline(roadMask, closed, 0.9);
    const midX = Math.floor(hm.width / 2);
    const midZ = Math.floor(hm.height / 2);
    const spawns = [
      { x: midX, z: pad },
      { x: hm.width - 1 - pad, z: midZ },
      { x: midX, z: hm.height - 1 - pad },
      { x: pad, z: midZ },
    ];
    for (const s of spawns) vehicles.spawnAt(s.x, s.z);
  } else {
    const cx = Math.floor(hm.width / 2);
    const cz = Math.floor(hm.height / 2);
    const rx = Math.max(4, Math.floor(hm.width / 2) - 8);
    const rz = Math.max(4, Math.floor(hm.height / 2) - 8);
    const sets = buildFigure8(cx, cz, rx, rz);
    for (const path of sets) {
      const closed = path.concat([path[0]]);
      roadsVis.addPath(closed);
      rasterizePolyline(roadMask, closed, 0.9);
    }
    const spawns = [
      { x: cx - rx, z: cz - 2 },
      { x: cx + rx, z: cz - 2 },
      { x: cx - rx, z: cz + 2 },
      { x: cx + rx, z: cz + 2 },
    ];
    for (const s of spawns) vehicles.spawnAt(s.x, s.z);
  }
  rebuildPath2Ds();
}

// Default preset
seedVariant('loop');
