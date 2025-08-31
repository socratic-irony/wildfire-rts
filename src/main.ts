import { Mesh, Object3D, BufferAttribute, Vector3, Raycaster, Vector2, BoxGeometry, MeshStandardMaterial, Color } from 'three';
import { createRenderer, resizeRenderer } from './core/renderer';
import { createScene } from './core/scene';
import { createCameraRig, resizeCamera } from './core/camera';
import { Loop } from './core/loop';
import { generateHeightmap } from './terrain/heightmap';
import { buildTerrainGeometry } from './terrain/mesh';
import { createTerrainMaterial } from './terrain/material';
// import { RTSCameraController } from './core/rtsCamera';
import { RTSOrbitCamera } from './core/rtsOrbit';
import { applyBiomeVertexColors, computeBiomes } from './terrain/biomes';
import { createForest } from './actors/trees';
import { createShrubs } from './actors/shrubs';
import { createRocks } from './actors/rocks';
import { buildChunkedTerrain } from './terrain/chunks';
import { attachStats } from './ui/debug';
import { buildFireGrid, ignite as igniteTiles } from './fire/grid';
import { FireSim } from './fire/sim';
import { createFireViz } from './fire/viz';
import { buildTerrainCost } from './roads/cost';
import { aStarPath } from './roads/astar';
import { RoadsVisual } from './roads/visual';
import { applyRoadMaskToFireGrid, createRoadMask, rasterizePolyline } from './roads/state';
import { VehiclesManager } from './vehicles/vehicles';
import { Path2D } from './paths/path2d';
import { PathFollower } from './vehicles/frenet';
// import { createFireTexture } from './fire/texture';

const app = document.getElementById('app')!;
const scene = createScene();
const rig = createCameraRig(app);
scene.add(rig.root);

const renderer = createRenderer(app);

// Stage B: Terrain heightmap + mesh (temporary orbit controls)
const hm = generateHeightmap(128, 128, 1, {
  seed: 42,
  frequency: 2.0,
  amplitude: 8,
  octaves: 4,
  persistence: 0.5,
});
// Biomes and material
const biomes = computeBiomes(hm);
const terrainMat = createTerrainMaterial() as any;

// Stage G: chunked terrain with basic LOD
const chunked = buildChunkedTerrain(hm, terrainMat, 32);
scene.add(chunked.group);

// Stage C: RTS camera controller (replaces Orbit)
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
  const keys = new Set(Array.from([])); // placeholder for future direct key handling
  const move = {
    left: (window as any).keyDown?.('a') || false,
    right: (window as any).keyDown?.('d') || false,
    up: (window as any).keyDown?.('w') || false,
    down: (window as any).keyDown?.('s') || false,
    yawL: (window as any).keyDown?.('q') || false,
    yawR: (window as any).keyDown?.('e') || false,
    tiltU: (window as any).keyDown?.('r') || false,
    tiltD: (window as any).keyDown?.('f') || false,
  };
  // Simple key detection without external libs
  // Attach once
  if (!(window as any)._wf_keys) {
    (window as any)._wf_keys = new Set<string>();
    window.addEventListener('keydown', (e) => (window as any)._wf_keys.add(e.key.toLowerCase()));
    window.addEventListener('keyup', (e) => (window as any)._wf_keys.delete(e.key.toLowerCase()));
    (window as any).keyDown = (k: string) => (window as any)._wf_keys.has(k);
  }
  move.left = (window as any).keyDown('a') || (window as any).keyDown('arrowleft');
  move.right = (window as any).keyDown('d') || (window as any).keyDown('arrowright');
  move.up = (window as any).keyDown('w') || (window as any).keyDown('arrowup');
  move.down = (window as any).keyDown('s') || (window as any).keyDown('arrowdown');

  orbit.update(dt, move);
  // Wind sway updates (Stage F)
  const t = performance.now() / 1000;
  forest?.update(t);
  shrubs?.update(t);
  // Update LOD for terrain chunks
  const camPos = rig.camera.getWorldPosition(new Vector3());
  chunked.updateLOD(camPos.x, camPos.z);
  // Simulate fire at fixed steps and update visualization
  fireSim.step(dt);
  fireViz.update(fireGrid, dt);
  if (followMode === 'grid') {
    vehicles.update(dt);
    if (yawDebugOn && yawDiv) {
      yawDiv.textContent = vehicles.getDebugText(0);
    }
  } else {
    for (const f of followers) f.update(dt);
  }
  renderer.render(scene, rig.camera);
  stats.update(dt, renderer);
});

// Toggle grid overlay (G)
window.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() === 'g') {
    const shader = (terrainMat as any).userData?.shader;
    if (shader) {
      shader.uniforms.uGridEnabled.value = shader.uniforms.uGridEnabled.value ? 0 : 1;
    }
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
    // One-shot dump to console for easy copy/paste
    console.log(vehicles.getDebugText(0));
  }
});

// Stage F: vegetation
const forest = createForest(hm, biomes);
scene.add(forest.leaves);
scene.add(forest.trunks);
if (forest.broadLeaves) scene.add(forest.broadLeaves);
if (forest.broadTrunks) scene.add(forest.broadTrunks);

const shrubs = createShrubs(hm, biomes);
scene.add(shrubs.inst);

const rocks = createRocks(hm, biomes);
scene.add(rocks.inst);

// Attach stats after actors/chunks are created so we can report counts
const stats = attachStats(app, { chunkGroup: chunked.group, forest, shrubs, rocks });
loop.start();

function onResize() {
  resizeRenderer(renderer, app);
  resizeCamera(rig, app);
}

window.addEventListener('resize', onResize);
onResize();

// Stage A-L (fire behavior) — initialize grid + viz, click to ignite
const fireGrid = buildFireGrid(hm, biomes, { cellSize: hm.scale });
const fireSim = new FireSim(fireGrid, { windDirRad: 0, windSpeed: 0 });
// Fire visualization controller
const fireViz = createFireViz(hm, chunked.group);
fireViz.addToScene(scene as any);
fireViz.setMode('vertex');

// Roads — cost field + visual + input state
const roadCost = buildTerrainCost(hm);
const roadsVis = new RoadsVisual(hm);
scene.add(roadsVis.group);
const roadMask = createRoadMask(hm.width, hm.height);
let roadsEnabled = false;
let roadEndpoints: Array<{ x: number; z: number }> = [];
type FollowMode = 'grid' | 'frenet';
let followMode: FollowMode = 'grid';
let path2ds: Path2D[] = [];
let followers: PathFollower[] = [];

function rebuildPath2Ds() {
  path2ds = roadsVis.getMidlinesXZ().map(pts => new Path2D(pts));
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
  const obj = new Object3D();
  const geo = new BoxGeometry(hm.scale * 0.6, hm.scale * 0.3, hm.scale * 0.9);
  const mat = new MeshStandardMaterial({ color: new Color(0x1e90ff), roughness: 0.7, metalness: 0.1 });
  const mesh = new Mesh(geo, mat); mesh.castShadow = true; obj.add(mesh);
  scene.add(obj);
  const follower = new PathFollower(path2ds[bestIdx], hm, obj, bestS);
  followers.push(follower);
}

// Vehicles — manager uses terrain cost and road mask
const vehicles = new VehiclesManager(hm, roadCost, roadMask, 64, roadsVis);
scene.add(vehicles.group);
let vehiclesMoveEnabled = false;
let yawDebugOn = false;
let yawDiv: HTMLDivElement | null = null;

// Click to ignite under cursor
{
  const ray = new Raycaster();
  const mouse = new Vector2();
  const dom = renderer.domElement;
  const ndcFromClient = (cx: number, cy: number) => {
    const rect = dom.getBoundingClientRect();
    mouse.x = ((cx - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((cy - rect.top) / rect.height) * 2 + 1;
  };
  function getMouseNDC(ev: MouseEvent) {
    ndcFromClient(ev.clientX, ev.clientY);
  }
  function igniteFromNDC(nx: number, ny: number) {
    mouse.set(nx, ny);
    ray.setFromCamera(mouse as any, rig.camera);
    const hits = ray.intersectObject(chunked.group, true);
    if (!hits.length) return false;
    const p = hits[0].point;
    const gx = Math.floor(p.x / hm.scale);
    const gz = Math.floor(p.z / hm.scale);
    igniteTiles(fireGrid, [{ x: gx, z: gz }], 0.8);
    return true;
  }
  dom.addEventListener('click', (e) => {
    getMouseNDC(e);
    // Roads placement when enabled
    if (roadsEnabled) {
      mouse.set(mouse.x, mouse.y);
      ray.setFromCamera(mouse as any, rig.camera);
      const hits = ray.intersectObject(chunked.group, true);
      if (hits.length) {
        const p = hits[0].point;
        const gx = Math.max(0, Math.min(hm.width - 1, Math.round(p.x / hm.scale)));
        const gz = Math.max(0, Math.min(hm.height - 1, Math.round(p.z / hm.scale)));
        roadEndpoints.push({ x: gx, z: gz });
        if (roadEndpoints.length >= 2) {
          const [a, b] = [roadEndpoints[roadEndpoints.length - 2], roadEndpoints[roadEndpoints.length - 1]];
          // Build cost function on the fly
          const WE = 0.6, WS = 2.0, WV = 0.8; // weights for elevation, slope, valley bonus (more slope penalty)
          const SLOPE_MAX_TAN = 0.7; // ~35 degrees; block steeper
          const CURV_W = 1.6;       // curvature/turning penalty
          const costField = {
            width: roadCost.width,
            height: roadCost.height,
            costAt: (x: number, z: number, stepDir: { dx: number; dz: number }, prevDir?: { dx: number; dz: number }) => {
              const i = z * roadCost.width + x;
              const base = 1 + WE * roadCost.elev[i] + WS * roadCost.slope[i] - WV * roadCost.valley[i];
              // Hard block steep terrain
              if (roadCost.slope[i] > SLOPE_MAX_TAN) return Infinity;
              // Curvature penalty: prefer straighter continuation if prevDir is provided
              let curv = 0;
              if (prevDir && (prevDir.dx !== 0 || prevDir.dz !== 0)) {
                const pvLen = Math.hypot(prevDir.dx, prevDir.dz) || 1;
                const stLen = Math.hypot(stepDir.dx, stepDir.dz) || 1;
                const pdx = prevDir.dx / pvLen, pdz = prevDir.dz / pvLen;
                const sdx = stepDir.dx / stLen, sdz = stepDir.dz / stLen;
                const dot = Math.max(-1, Math.min(1, pdx * sdx + pdz * sdz));
                // Penalize turns; 0 for straight, up to CURV_W for 180°
                curv = CURV_W * (1 - Math.max(0, dot));
              }
              return Math.max(0.05, base + curv);
            }
          };
          const path = aStarPath(costField as any, a, b, { diag: true, heuristic: 'euclid', maxIter: roadCost.width * roadCost.height * 6 });
          if (path.length) {
            roadsVis.addPath(path);
            rasterizePolyline(roadMask, path, 0.9);
            applyRoadMaskToFireGrid(fireGrid, roadMask);
            rebuildPath2Ds();
          }
        }
      }
      return;
    }
    // Vehicle movement when enabled
    if (vehiclesMoveEnabled) {
      mouse.set(mouse.x, mouse.y);
      ray.setFromCamera(mouse as any, rig.camera);
      const hits = ray.intersectObject(chunked.group, true);
      if (hits.length) {
        const p = hits[0].point;
        const gx = Math.max(0, Math.min(hm.width - 1, Math.round(p.x / hm.scale)));
        const gz = Math.max(0, Math.min(hm.height - 1, Math.round(p.z / hm.scale)));
        vehicles.setDestinationAll(gx, gz);
      }
      return;
    }
    // Ignite when toggle is on
    if (stats.getIgniteMode()) {
      igniteFromNDC(mouse.x, mouse.y);
    }
  });

  // Wire Debug UI: Ignite Center + Viz Mode action
  stats.setActions({
    igniteCenter: () => {
      // Screen center is NDC (0,0)
      igniteFromNDC(0, 0);
    },
    setVizMode: (mode) => fireViz.setMode(mode),
    roads: {
      toggle: (on) => { roadsEnabled = on; if (!on) roadEndpoints = []; },
      clear: () => { roadsVis.clear(); roadEndpoints = []; clearFollowers(); rebuildPath2Ds(); }
    },
    vehicles: {
      spawn: () => {
        if (followMode === 'grid') {
          const camPos = rig.camera.getWorldPosition(new Vector3());
          const gx = Math.max(0, Math.min(hm.width - 1, Math.round(camPos.x / hm.scale)));
          const gz = Math.max(0, Math.min(hm.height - 1, Math.round(camPos.z / hm.scale)));
          vehicles.spawnAt(gx, gz);
        } else {
          rebuildPath2Ds();
          spawnFollowerAtCamera();
        }
      },
      moveModeToggle: (on) => { vehiclesMoveEnabled = on; },
      clear: () => { vehicles.clear(); clearFollowers(); },
      setYawMode: (m) => vehicles.setYawMode(m),
      toggleYawSmoothing: (on) => vehicles.setYawSmoothing(on),
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
    }
  });
}
