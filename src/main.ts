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

// Config and console system
import { config, isFeatureEnabled } from './config/features';
import { DebugConsole } from './ui/console';

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

// Initialize debug console if enabled
let debugConsole: DebugConsole | undefined;
if (isFeatureEnabled('console_commands')) {
  debugConsole = new DebugConsole(app);
  
  // Register fire-related commands
  debugConsole.registerCommand({
    name: 'fire.ignite',
    description: 'Ignite fire at grid coordinates (x z)',
    execute: (args) => {
      if (args.length < 2) return 'Usage: fire.ignite <x> <z>';
      const x = parseInt(args[0]);
      const z = parseInt(args[1]);
      if (isNaN(x) || isNaN(z)) return 'Invalid coordinates';
      igniteTiles(fireGrid, [{ x, z }], 0.8);
      return `Ignited fire at (${x}, ${z})`;
    }
  });
  
  debugConsole.registerCommand({
    name: 'fire.stats',
    description: 'Display fire simulation statistics',
    execute: () => {
      const burning = fireGrid.bCount;
      const smoldering = fireGrid.sCount;
      const total = fireGrid.width * fireGrid.height;
      const burned = fireGrid.tiles.filter(t => t.state === 'burned').length;
      return [
        'Fire Statistics:',
        `  Burning tiles: ${burning}`,
        `  Smoldering tiles: ${smoldering}`,
        `  Burned tiles: ${burned}`,
        `  Total tiles: ${total}`,
        `  Simulation time: ${fireGrid.time.toFixed(2)}s`
      ].join('\n');
    }
  });
  
  debugConsole.registerCommand({
    name: 'fire.clear',
    description: 'Extinguish all fires',
    execute: () => {
      // Reset fire grid by setting all tiles to unburned
      fireGrid.tiles.forEach(tile => {
        tile.state = 'unburned';
        tile.heat = 0;
        tile.progress = 0;
      });
      fireGrid.burning = [];
      fireGrid.smoldering = [];
      fireGrid.bCount = 0;
      fireGrid.sCount = 0;
      return 'All fires extinguished';
    }
  });
  
  // Terrain commands
  debugConsole.registerCommand({
    name: 'terrain.info',
    description: 'Get terrain info at grid coordinates (x z)',
    execute: (args) => {
      if (args.length < 2) return 'Usage: terrain.info <x> <z>';
      const x = parseInt(args[0]);
      const z = parseInt(args[1]);
      if (isNaN(x) || isNaN(z) || x < 0 || z < 0 || x >= hm.width || z >= hm.height) {
        return 'Invalid coordinates';
      }
      const elevation = hm.sample(x * hm.scale, z * hm.scale);
      const biome = biomes.forest[z * hm.width + x] > 0.5 ? 'forest' : 
                   biomes.chaparral[z * hm.width + x] > 0.5 ? 'chaparral' : 'rock';
      return [
        `Terrain Info at (${x}, ${z}):`,
        `  Elevation: ${elevation.toFixed(2)}m`,
        `  Biome: ${biome}`,
        `  World coords: (${(x * hm.scale).toFixed(1)}, ${(z * hm.scale).toFixed(1)})`
      ].join('\n');
    }
  });
  
  // Vehicle commands (avoiding direct coupling)
  debugConsole.registerCommand({
    name: 'vehicles.count',
    description: 'Display current vehicle count',
    execute: () => `Vehicle count: ${vehicles.count}`
  });
  
  debugConsole.registerCommand({
    name: 'vehicles.clear',
    description: 'Remove all vehicles',
    execute: () => {
      vehicles.clear();
      clearFollowers();
      return 'All vehicles cleared';
    }
  });
}

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
let followMode: FollowMode = 'frenet';
let path2ds: Path2D[] = [];
let followers: PathFollower[] = [];
type SpacingMode = 'hybrid' | 'gap' | 'time';
let spacingMode: SpacingMode = 'hybrid';

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
// Default to Frenet: hide grid vehicles by default
vehicles.group.visible = (followMode === 'grid');

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
    }
  });
}
