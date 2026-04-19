import { Mesh, Object3D, BufferAttribute, Vector3, Quaternion, Raycaster, Vector2, BoxGeometry, MeshStandardMaterial, Color, BufferGeometry, CylinderGeometry } from 'three';
import { createRenderer, resizeRenderer } from './core/renderer';
import { createScene } from './core/scene';
import { createCameraRig, resizeCamera } from './core/camera';
import { Loop } from './core/loop';
import { attachInput } from './core/input';
import { generateHeightmap } from './terrain/heightmap';
import { buildTerrainGeometry } from './terrain/mesh';
import { createTerrainMaterial } from './terrain/material';
import { RTSOrbitCamera } from './core/rtsOrbit';
import { applyBiomeVertexColors, computeBiomes, computeBiomesTuned } from './terrain/biomes';
import { createForest } from './actors/trees';
import { createShrubs } from './actors/shrubs';
import { createRocks } from './actors/rocks';
import { buildChunkedTerrain } from './terrain/chunks';
// import { attachStats } from './ui/debug'; // Removed - functionality moved to menubar
import { installGlobalErrorOverlay } from './ui/errorOverlay';
import { createMenubar } from './ui/menubar';
import { createPaintSystem } from './ui/paint';
import { buildFireGrid, ignite as igniteTiles, FireState, applyWaterAoEWithHydrants } from './fire/grid';
import { FireSim } from './fire/sim';
import type { Env as FireEnv } from './fire/sim';
import { createFireViz } from './fire/viz';
import { createFireRibbon } from './particles/ribbon';
import { createFlipbookParticles } from './particles/flipbook';
import { createSuppressionDecals } from './fire/decals';
import { createHydrantSystem, updateHydrantPlacement, clearHydrants } from './fire/hydrants';
import { HydrantVisual } from './fire/hydrantVisual';
import { buildTerrainCost } from './roads/cost';
import { aStarPath } from './roads/astar';
import { RoadsVisual } from './roads/visual';
import { applyRoadMaskToFireGrid, clearRoadMask, createRoadMask, rasterizePolyline } from './roads/state';
import { makeAngularPath } from './roads/path';
import { generateProceduralRoads } from './roads/procedural';
import { VehiclesManager, VehicleType as VManagerVehicleType, VehicleFxState } from './vehicles/vehicles';
import { getDefaults } from './vehicles/typeDefaults';
import { createPayload, tickFuel, needsReturnToBase, consumeWater, refuel, refill, type PayloadState } from './vehicles/payload';
import { Path2D } from './paths/path2d';
import { PathFollower } from './vehicles/frenet';
import { IntersectionManager, IntersectionInfo } from './vehicles/intersectionManager';
import { createFollowerSelection, findFollowerHit, issueMoveOrder, setTargetOnCurrentPath, updateOffroadFollowers, type FollowerEntry } from './vehicles/followerOrders';
import { mapMenubarToVehicleType } from './vehicles/menubarMapping';
import { createIncidentRegistry } from './dispatch/incident';
import { createDispatchLoop, type FollowerRef } from './systems/dispatchLoop';
import { DispatchPanel } from './ui/dispatchPanel';

// Config and console system
import { config, isFeatureEnabled } from './config/features';
import { DebugConsole } from './ui/console';
import { getLogger } from '../tools/logging/index.js';

// Initialize logging for application startup
const logger = getLogger();
logger.info('Wildfire RTS application starting');

const app = document.getElementById('app')!;
const scene = createScene();
const rig = createCameraRig(app);
scene.add(rig.root);

const renderer = createRenderer(app);
const input = attachInput(renderer.domElement);
installGlobalErrorOverlay(app);
// Hover tile debug overlay state (sample at ~10 Hz)
let _hoverAcc = 0;
let _hoverMouseX = 0, _hoverMouseY = 0;
let _hoverHasMouse = false;
let _hoverTileDiv: HTMLDivElement | null = null;
const _hoverRay = new Raycaster();
const _hoverMouse = new Vector2();

// World config used by Debug UI
type WorldCfg = {
  width: number; height: number;
  noise: { seed: string | number; frequency: number; amplitude: number; octaves: number; persistence: number };
  moisture: { seed: string | number };
  biomes: { forestMoistureMin: number };
  densities: { tree: number; shrub: number; rock: number; broadleafRatio: number };
};
let worldCfg: WorldCfg = {
  width: 128, height: 128,
  noise: { seed: '42', frequency: 2.0, amplitude: 5, octaves: 4, persistence: 0.5 },
  moisture: { seed: 'moist' },
  biomes: { forestMoistureMin: 0.55 },
  densities: { tree: 0.30, shrub: 0.15, rock: 0.08, broadleafRatio: 0.4 },
};

// Stage B: Terrain heightmap + mesh (temporary orbit controls)
let hm = generateHeightmap(worldCfg.width, worldCfg.height, 1, worldCfg.noise);
// Biomes and material
let biomes = computeBiomesTuned(hm, { forestMoistureMin: worldCfg.biomes.forestMoistureMin }, { seed: worldCfg.moisture.seed as any });
const terrainMat = createTerrainMaterial() as any;

// Stage G: chunked terrain with basic LOD
let chunked = buildChunkedTerrain(hm, terrainMat, 32, biomes);
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
  const move = {
    left: input.keys.has('a') || input.keys.has('arrowleft'),
    right: input.keys.has('d') || input.keys.has('arrowright'),
    up: input.keys.has('w') || input.keys.has('arrowup'),
    down: input.keys.has('s') || input.keys.has('arrowdown'),
    yawL: input.keys.has('q'),
    yawR: input.keys.has('e'),
    tiltU: input.keys.has('r'),
    tiltD: input.keys.has('f'),
  };

  orbit.update(dt, move);
  // Wind sway updates (Stage F)
  const t = performance.now() / 1000;
  forest?.update(t);
  shrubs?.update(t);
  // Periodically apply burn tint to vegetation from fire grid
  vegTintAcc += dt;
  if (vegTintAcc >= 0.5) {
    vegTintAcc = 0;
    forest?.applyFireTint?.(fireGrid as any);
    shrubs?.applyFireTint?.(fireGrid as any);
  }
  selection.update();
  // Update LOD for terrain chunks
  const camPos = rig.camera.getWorldPosition(new Vector3());
  chunked.updateLOD(camPos.x, camPos.z);
  // Simulate fire at fixed steps and update visualization
  fireSim.step(dt);
  fireViz.update(fireGrid, dt);
  // Update water and retardant decals
  suppressionDecals.update(fireGrid);

  // Dispatch loop — detect incidents, auto-assign, promote/resolve
  {
    const followerRefs: FollowerRef[] = followers.map(f => ({
      id: f.id,
      type: f.type,
      follower: f.follower,
      busy: f.busy,
    }));
    dispatchLoop.tick(dt, fireGrid.time, fireGrid, followerRefs, path2ds);
    // Sync busy flag back from followerRefs (dispatch loop may have updated it)
    for (const ref of followerRefs) {
      const f = followers.find(x => x.id === ref.id);
      if (f) f.busy = ref.busy;
    }
    syncFollowerAssignments();
    updateFollowerSuppression(dt);
    updateFollowerLogistics(dt);
  }
  // Hover overlay update at ~10 Hz independent of mouse movement
  _hoverAcc += dt;
  if (_hoverAcc >= 0.1 && _hoverHasMouse) {
    _hoverAcc = 0;
    const rect = renderer.domElement.getBoundingClientRect();
    const nx = ((_hoverMouseX - rect.left) / rect.width) * 2 - 1;
    const ny = -((_hoverMouseY - rect.top) / rect.height) * 2 + 1;
    _hoverMouse.set(nx, ny);
    _hoverRay.setFromCamera(_hoverMouse as any, rig.camera);
    const hits = _hoverRay.intersectObject(chunked.group, true);
    if (hits.length) {
      const p = hits[0].point;
      const gx = Math.max(0, Math.min(hm.width - 1, Math.round(p.x / hm.scale)));
      const gz = Math.max(0, Math.min(hm.height - 1, Math.round(p.z / hm.scale)));
      const idx = gz * fireGrid.width + gx;
      const t0 = fireGrid.tiles[idx];
      const stateName = ['Unburned','Igniting','Burning','Smoldering','Burned'][t0.state] || String(t0.state);
      const th = fireGrid.params.thresholds;
      const windDeg = ((simEnv.windDirRad * 180 / Math.PI) % 360 + 360) % 360;
      const lines =
        `Tile ${gx},${gz}  Fuel ${t0.fuel}\n` +
        `State ${stateName}  Heat ${t0.heat.toFixed(2)}  Prog ${t0.progress.toFixed(2)}\n` +
        `Moist ${t0.fuelMoisture.toFixed(2)}  Wet ${t0.wetness.toFixed(2)}  Ret ${t0.retardant.toFixed(2)}  Line ${t0.lineStrength.toFixed(2)}\n` +
        `SlopeTan ${t0.slopeTan.toFixed(2)}  Wind ${simEnv.windSpeed.toFixed(1)} m/s @ ${windDeg.toFixed(0)}°\n` +
        `Thresh: ExtinguishHeat ${th.extinguishHeat.toFixed(2)}  CrownHeat ${th.crownHeat.toFixed(2)}`;
      if (_hoverTileDiv) _hoverTileDiv.textContent = lines;
    } else {
      if (_hoverTileDiv) _hoverTileDiv.textContent = '';
    }
  }
  // Update perimeter ribbon
  fireRibbon.update(fireGrid as any, performance.now() / 1000);
  // Update flipbook particles with real wind from simEnv
  fireParticles.update(fireGrid as any, simEnv, dt, rig.camera);
  
  // Always update Frenet followers with intersection-aware speed control
  const groups = new Map<Path2D, number[]>();
  updateOffroadFollowers(followers as FollowerEntry[], hm, dt);
  for (let i = 0; i < followers.length; i++) {
    if (followers[i].type === VManagerVehicleType.BULLDOZER && followers[i].offroadTarget) continue;
    const p = followers[i].follower.path as Path2D;
    if (!groups.has(p)) groups.set(p, []);
    groups.get(p)!.push(i);
  }
  for (const [path, idxs] of groups) {
    idxs.sort((a, b) => followers[a].follower.s - followers[b].follower.s);
    for (let k = idxs.length - 1; k >= 0; k--) {
      const idx = idxs[k];
      const current = followers[idx].follower;
      if (k === idxs.length - 1) {
        current.setLeader(undefined, undefined);
      } else {
        const leadIdx = idxs[k + 1];
        const leadFollower = followers[leadIdx].follower;
        current.setLeader(leadFollower.s, leadFollower.v);
      }
      current.setSpacingMode(spacingMode);
      intersectionManager.preUpdateFollower(current, path, dt);
      current.update(dt);
      intersectionManager.postUpdateFollower(current, path);
    }
  }

  followerFxStates.length = 0;
  for (const entry of followers) {
    entry.object.matrix.decompose(tmpFollowerPos, tmpFollowerQuat, tmpFollowerScale);
    tmpFollowerForward.set(0, 0, 1).applyQuaternion(tmpFollowerQuat).normalize();
    tmpFollowerUp.set(0, 1, 0).applyQuaternion(tmpFollowerQuat).normalize();
    tmpFollowerRight.set(1, 0, 0).applyQuaternion(tmpFollowerQuat).normalize();

    const fx = entry.fxState;
    fx.pos.copy(tmpFollowerPos);
    fx.forward.copy(tmpFollowerForward);
    fx.up.copy(tmpFollowerUp);
    fx.right.copy(tmpFollowerRight);
    fx.speed = entry.follower.v;
    // sprayingWater is controlled by updateFollowerSuppression()
    fx.siren = entry.type === VManagerVehicleType.FIRETRUCK;
    followerFxStates.push(fx);
  }
  vehicles.updateExternalFx(dt, followerFxStates);

  renderer.render(scene, rig.camera);
  
  // Update paint system
  if (paintSystem) {
    paintSystem.update(dt);
    // Sync tool between menubar and paint system
    const menubarTool = menubar.getCurrentTool();
    if (paintSystem.getCurrentTool() !== menubarTool) {
      paintSystem.setCurrentTool(menubarTool);
    }
  }
  
  // Update unified menubar/debug interface
  menubar.update(dt, renderer, { chunkGroup: chunked.group, forest, shrubs, rocks, fireGrid, followers });
  // Update dispatch panel (refresh at 5 Hz to keep DOM updates cheap)
  dispatchPanel.update(followers.length, followers.filter(f => f.busy).length);
  // (intersection manager already ran pre-update in Frenet mode)
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
let forest = createForest(hm, biomes, { density: worldCfg.densities.tree, broadleafRatio: worldCfg.densities.broadleafRatio });
scene.add(forest.leaves);
scene.add(forest.trunks);
if (forest.broadLeaves) scene.add(forest.broadLeaves);
if (forest.broadTrunks) scene.add(forest.broadTrunks);

let shrubs = createShrubs(hm, biomes, { density: worldCfg.densities.shrub });
scene.add(shrubs.inst);

let rocks = createRocks(hm, biomes, { density: worldCfg.densities.rock });
scene.add(rocks.inst);

// Create unified menubar/debug interface
const menubar = createMenubar(app);

// Create paint system (will be initialized after fire grid is available)
let paintSystem: ReturnType<typeof createPaintSystem> | null = null;

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
      const burned = fireGrid.tiles.filter(t => t.state === FireState.Burned).length;
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
        tile.state = FireState.Unburned;
        tile.heat = 0;
        tile.progress = 0;
      });
      fireGrid.burning = new Uint32Array(fireGrid.burning.length);
      fireGrid.smoldering = new Uint32Array(fireGrid.smoldering.length);
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
logger.info('Wildfire RTS application fully initialized and running');

// Vegetation burn tint cadence accumulator
let vegTintAcc = 0;

function onResize() {
  resizeRenderer(renderer, app);
  resizeCamera(rig, app);
}

window.addEventListener('resize', onResize);
onResize();

// Stage A-L (fire behavior) — initialize grid + viz, click to ignite
let fireGrid = buildFireGrid(hm, biomes, { cellSize: hm.scale });
let simEnv: FireEnv = { windDirRad: 0, windSpeed: 0 };
let fireSim = new FireSim(fireGrid, simEnv);

// Initialize paint system now that fire grid is available
paintSystem = createPaintSystem(renderer.domElement, rig.camera, chunked.group, hm, fireGrid);

// Connect paint system to camera to lock camera movement during painting operations
orbit.setInputLockCheck(() => paintSystem?.isActivePainting() || false);

// Fire visualization controller
let fireViz = createFireViz(hm, chunked.group);
fireViz.addToScene(scene as any);
fireViz.setMode('vertex');
// Water and retardant decal overlays
let suppressionDecals = createSuppressionDecals(hm, { offsetY: 0.05, depthTest: false });
suppressionDecals.addToScene(scene);
// Flipbook billboard particles (flame/smoke)
let fireParticles = createFlipbookParticles(hm);
scene.add((fireParticles as any).group);
// Perimeter ribbon (animated strip)
let fireRibbon = createFireRibbon(hm, { width: 0.45, yOffset: 0.12 });
scene.add(fireRibbon.mesh);

// Update debug interface with fireGrid reference now that it's available
// (followers wired in later via setRefs once declared)
menubar.setRefs?.({ chunkGroup: chunked.group, forest, shrubs, rocks, fireGrid });

// Roads — cost field + visual + input state
let roadCost = buildTerrainCost(hm);
let roadsVis = new RoadsVisual(hm);
scene.add(roadsVis.group);
let roadMask = createRoadMask(hm.width, hm.height);
let roadsEnabled = false;
let roadEndpoints: Array<{ x: number; z: number }> = [];
let roadPaths: Array<Array<{ x: number; z: number }>> = [];
let path2ds: Path2D[] = [];
// ===== VEHICLE SYSTEMS ARCHITECTURE =====
// This application uses a dual vehicle system design:
//
// 1. PathFollower System (Primary for UI interactions):
//    - Used for all user-spawned vehicles via UI buttons
//    - Provides smooth Frenet-frame movement along roads
//    - Individual Object3D instances with custom geometries
//    - Managed in an `ActiveFollower[]` collection with per-vehicle FX state
//
// 2. VehiclesManager System (Testing & Abilities):
//    - Uses InstancedMesh for performance with many vehicles
//    - Provides vehicle abilities (sprayWater, particle effects)
//    - Used primarily in tests and specialized scenarios
//    - Grid-based movement and pathfinding
//
// Both systems are maintained for different purposes and cleared together
// to ensure consistency when the user resets the scene.
// ==========================================

type ActiveFollower = {
  id: number;
  follower: PathFollower;
  object: Object3D;
  mesh: Mesh;
  type: VManagerVehicleType;
  fxState: VehicleFxState;
  payload: PayloadState;
  busy: boolean;
  assignedIncidentId: number | null;
  returningToBase: boolean;
  homePos: { x: number; z: number };
  offroadTarget?: Vector3 | null;
};

let followers: ActiveFollower[] = [];
let followerIdCounter = 0;
const followerFxStates: VehicleFxState[] = [];
const tmpFollowerPos = new Vector3();
const tmpFollowerQuat = new Quaternion();
const tmpFollowerScale = new Vector3();
const tmpFollowerForward = new Vector3();
const tmpFollowerUp = new Vector3();
const tmpFollowerRight = new Vector3();
const tmpFollowerWorld = new Vector3();
type SpacingMode = 'hybrid' | 'gap' | 'time';
let spacingMode: SpacingMode = 'hybrid';
let pathIntersections: IntersectionInfo[][] = [];
const intersectionManager = new IntersectionManager();

/** Distance ahead of an intersection (meters) that must be clear before granting entry. */
const INTERSECTION_CLEAR_ZONE = 8;

intersectionManager.setCanEnterProbe((follower, info) => {
  return !followers.some(other => {
    if (other.follower === follower) return false;
    if (other.follower.path !== follower.path) return false;
    let ds = other.follower.s - info.s;
    if (follower.path.closed && ds < 0) ds += follower.path.length;
    return ds > 0 && ds < INTERSECTION_CLEAR_ZONE;
  });
});

const selection = createFollowerSelection(scene);

function rebuildPath2Ds() {
  roadsVis.buildIntersections();
  const raw = roadsVis.getMidlinesXZ();
  const rawIntersections = raw.map((_, idx) => roadsVis.getIntersectionsForPath(idx));
  const stitched: Array<{ pts: Array<{ x: number; z: number }>; components: number[] }> = [];
  const used = new Array(raw.length).fill(false);
  const eps = hm.scale * 0.6;
  const near = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z) <= eps;
  for (let i = 0; i < raw.length; i++) {
    if (used[i] || raw[i].length < 2) continue;
    let cur = raw[i].slice();
    const comps = [i];
    used[i] = true;
    let extended = true;
    while (extended) {
      extended = false;
      for (let j = 0; j < raw.length; j++) {
        if (used[j] || raw[j].length < 2) continue;
        const a0 = cur[0], a1 = cur[cur.length - 1];
        const b0 = raw[j][0], b1 = raw[j][raw[j].length - 1];
        if (near(a1, b0)) { cur = cur.concat(raw[j].slice(1)); used[j] = true; comps.push(j); extended = true; }
        else if (near(a1, b1)) { cur = cur.concat(raw[j].slice(0, raw[j].length - 1).reverse()); used[j] = true; comps.push(j); extended = true; }
        else if (near(a0, b1)) { cur = raw[j].concat(cur.slice(1)); used[j] = true; comps.push(j); extended = true; }
        else if (near(a0, b0)) { cur = raw[j].slice().reverse().concat(cur.slice(1)); used[j] = true; comps.push(j); extended = true; }
      }
    }
    stitched.push({ pts: cur, components: comps });
  }
  for (let i = 0; i < raw.length; i++) {
    if (!used[i] && raw[i].length >= 2) stitched.push({ pts: raw[i], components: [i] });
  }

  const newPaths: Path2D[] = [];
  const newIntersections: IntersectionInfo[][] = [];
  for (const { pts, components } of stitched) {
    if (pts.length < 2) continue;
    const first = pts[0];
    const last = pts[pts.length - 1];
    const isClosed = Math.hypot(first.x - last.x, first.z - last.z) < hm.scale * 1.5;
    const path = new Path2D(pts, { closed: isClosed });
    const interMap = new Map<number, IntersectionInfo>();
    for (const idx of components) {
      const list = rawIntersections[idx] || [];
      for (const inter of list) {
        if (interMap.has(inter.id)) continue;
        const proj = path.project({ x: inter.pos.x, z: inter.pos.z });
        interMap.set(inter.id, { id: inter.id, s: proj.s, pos: { x: inter.pos.x, z: inter.pos.z } });
      }
    }
    const ordered = Array.from(interMap.values()).sort((a, b) => a.s - b.s);
    newPaths.push(path);
    newIntersections.push(ordered);
  }
  path2ds = newPaths;
  pathIntersections = newIntersections;
  intersectionManager.setPaths(path2ds.map((path, idx) => ({ path, intersections: pathIntersections[idx] || [] })));
}

function applyRoadPaths() {
  roadsVis.clear();
  clearRoadMask(roadMask);
  for (const path of roadPaths) {
    if (path.length < 2) continue;
    roadsVis.addPath(path);
    rasterizePolyline(roadMask, path, 0.9);
  }
  applyRoadMaskToFireGrid(fireGrid, roadMask);
  updateHydrantPlacement(hydrantSystem);
  hydrantVisual.update(hydrantSystem);
  rebuildPath2Ds();
}

function seedProceduralRoads(count = 2) {
  roadPaths = generateProceduralRoads(hm, {
    count,
    kinds: ['figure8'],
    seed: Math.floor(Math.random() * 1e9)
  });
  applyRoadPaths();
}

function createFollowerMesh(vehicleType: VManagerVehicleType): Mesh {
  const scale = hm.scale;
  const defaults = getDefaults(vehicleType);
  let geo: BufferGeometry;
  switch (vehicleType) {
    case VManagerVehicleType.FIRETRUCK:
      geo = new BoxGeometry(scale * 0.9, scale * 0.6, scale * 1.6);
      break;
    case VManagerVehicleType.BULLDOZER:
      geo = new BoxGeometry(scale * 0.7, scale * 0.35, scale * 0.8);
      break;
    case VManagerVehicleType.CAR:
    default:
      geo = new BoxGeometry(scale * 0.5, scale * 0.25, scale * 1.0);
      break;
  }
  const mat = new MeshStandardMaterial({
    color: new Color(defaults.color),
    roughness: defaults.roughness,
    metalness: defaults.metalness,
    emissive: new Color(defaults.emissive),
    emissiveIntensity: defaults.emissiveIntensity,
  });
  const mesh = new Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  return mesh;
}

function spawnFollowersOnAllPaths(perPath = 3) {
  const typeSequence = [
    VManagerVehicleType.CAR,
    VManagerVehicleType.FIRETRUCK,
    VManagerVehicleType.BULLDOZER,
  ];
  for (const p of path2ds) {
    const total = Math.max(1, perPath);
    for (let k = 0; k < total; k++) {
      const obj = new Object3D();
      const vehicleType = typeSequence[(followerIdCounter + k) % typeSequence.length];
      const mesh = createFollowerMesh(vehicleType);
      obj.add(mesh);
      scene.add(obj);
      const startS = (p.length / total) * k;
      const follower = new PathFollower(p, hm, obj, startS);
      follower.setSpacingMode(spacingMode);
      const id = followerIdCounter++;
      const fxState: VehicleFxState = {
        id,
        pos: new Vector3(),
        forward: new Vector3(),
        up: new Vector3(),
        right: new Vector3(),
        speed: 0,
        type: vehicleType,
        sprayingWater: false,
        siren: vehicleType === VManagerVehicleType.FIRETRUCK,
      };
      const p0 = obj.getWorldPosition(new Vector3());
      followers.push({ id, follower, object: obj, mesh, type: vehicleType, fxState, payload: createPayload(vehicleType), busy: false, assignedIncidentId: null, returningToBase: false, homePos: { x: p0.x, z: p0.z }, offroadTarget: null });
    }
  }
}
function reseedRoadsAndVehicles(count = 2) {
  seedProceduralRoads(count);
  clearFollowers();
  spawnFollowersOnAllPaths(1);
}
function clearFollowers() {
  for (const f of followers) scene.remove(f.object);
  followers = [];
  followerFxStates.length = 0;
  followerIdCounter = 0;
  vehicles.updateExternalFx(0, followerFxStates);
  intersectionManager.clearFollowers();
  selection.clear();
}
/**
 * Spawn a PathFollower vehicle near the camera position
 * This is the primary vehicle spawning system for UI interactions.
 * Creates individual Object3D with appropriate geometry and material,
 * then adds a PathFollower for smooth road-following movement.
 */
function spawnFollowerAtCamera(vehicleType?: VManagerVehicleType) {
  if (!path2ds.length) return;
  const camPos = rig.camera.getWorldPosition(new Vector3());
  const start = { x: camPos.x, z: camPos.z };
  let bestIdx = 0, bestDist = Infinity, bestS = 0;
  for (let i = 0; i < path2ds.length; i++) {
    const proj = path2ds[i].project(start);
    if (proj.dist < bestDist) { bestDist = proj.dist; bestS = proj.s; bestIdx = i; }
  }
  const obj = new Object3D();
  const type = vehicleType ?? VManagerVehicleType.CAR;
  const mesh = createFollowerMesh(type);
  obj.add(mesh);
  scene.add(obj);
  const follower = new PathFollower(path2ds[bestIdx], hm, obj, bestS);
  follower.setSpacingMode(spacingMode);
  const id = followerIdCounter++;
  const fxState: VehicleFxState = {
    id,
    pos: new Vector3(),
    forward: new Vector3(),
    up: new Vector3(),
    right: new Vector3(),
    speed: 0,
    type,
    sprayingWater: false,
    siren: type === VManagerVehicleType.FIRETRUCK,
  };
  followers.push({ id, follower, object: obj, mesh, type, fxState, payload: createPayload(type), busy: false, assignedIncidentId: null, returningToBase: false, homePos: { x: camPos.x, z: camPos.z }, offroadTarget: null });
}


// Vehicles — VehiclesManager provides abilities and particle systems
// Note: Primary vehicle spawning uses PathFollower system above
// VehiclesManager is used for testing, abilities (sprayWater), and special scenarios
let vehicles = new VehiclesManager(hm, roadCost, roadMask, 64, roadsVis, fireGrid);
scene.add(vehicles.group);
scene.add(vehicles.particleGroup); // Add particle group separately so it stays visible
let vehiclesMoveEnabled = false;
let yawDebugOn = false;
let yawDiv: HTMLDivElement | null = null;
// Show vehicles - always visible since we only use Frenet vehicles
vehicles.group.visible = true;

// Fire Hydrants — automatic placement along roads
let hydrantSystem = createHydrantSystem(roadMask, hm.scale);
let hydrantVisual = new HydrantVisual(hm);
scene.add(hydrantVisual.group);
hydrantVisual.setVisible(true); // Initially visible

// Dispatch — incident registry + auto-assignment loop + UI panel
const incidentRegistry = createIncidentRegistry(hm.scale);
const dispatchLoop = createDispatchLoop(incidentRegistry, { detectInterval: 1.0, autoDispatch: true });

// ── Suppression & logistics helpers ──────────────────────────────────────────

/** Maximum distance (meters) from an engaged incident at which a unit actively suppresses. */
const SUPPRESSION_RANGE_METERS = 10;

/** Distance (meters) from home position at which a returning unit is considered arrived. */
const HOME_ARRIVAL_THRESHOLD = 6;

function syncFollowerAssignments() {
  const assigned = new Map<number, number>();
  for (const inc of dispatchLoop.registry.list()) {
    if (inc.status === 'resolved') continue;
    for (const uid of inc.assignedFollowerIds) assigned.set(uid, inc.id);
  }
  for (const entry of followers) {
    entry.assignedIncidentId = assigned.get(entry.id) ?? null;
  }
}

function sendFollowerHome(entry: ActiveFollower) {
  if (!entry.returningToBase && entry.assignedIncidentId != null) {
    dispatchLoop.registry.reopen(entry.assignedIncidentId);
  }
  entry.assignedIncidentId = null;
  entry.returningToBase = true;
  entry.fxState.sprayingWater = false;
  issueMoveOrder(entry as unknown as FollowerEntry, path2ds, new Vector3(entry.homePos.x, 0, entry.homePos.z));
}

function updateFollowerSuppression(dt: number) {
  for (const entry of followers) {
    entry.fxState.sprayingWater = false;

    const incId = entry.assignedIncidentId;
    if (incId == null) continue;

    const inc = dispatchLoop.registry.byId(incId);
    if (!inc || inc.status !== 'engaged') continue;

    const pos = entry.object.getWorldPosition(tmpFollowerWorld);
    const d = Math.hypot(pos.x - inc.pos.x, pos.z - inc.pos.z);
    if (d > SUPPRESSION_RANGE_METERS) continue;

    const litersPerSec =
      entry.type === VManagerVehicleType.FIRETRUCK ? 220 :
      entry.type === VManagerVehicleType.HELICOPTER ? 150 :
      entry.type === VManagerVehicleType.AIRPLANE ? 700 :
      entry.type === VManagerVehicleType.FIREFIGHTER ? 12 :
      0;

    if (litersPerSec <= 0) continue;

    const drawn = consumeWater(entry.payload, litersPerSec * dt);
    if (drawn <= 0) {
      sendFollowerHome(entry);
      continue;
    }

    entry.fxState.sprayingWater = true;

    applyWaterAoEWithHydrants(
      fireGrid,
      { x: inc.tile.x + 0.5, z: inc.tile.z + 0.5 },
      entry.type === VManagerVehicleType.AIRPLANE ? 4.5 : 2.5,
      Math.min(0.55, 0.15 + drawn / 900),
      hydrantSystem as any,
    );
  }
}

function updateFollowerLogistics(dt: number) {
  for (const entry of followers) {
    const loadFactor =
      entry.payload.waterCapacity > 0
        ? 1 + 0.25 * (entry.payload.water / entry.payload.waterCapacity)
        : 1;

    if (entry.follower.v > 0.05) {
      tickFuel(entry.payload, dt, loadFactor);
    }

    if (!entry.returningToBase && needsReturnToBase(entry.payload)) {
      sendFollowerHome(entry);
      continue;
    }

    if (entry.returningToBase) {
      const p = entry.object.getWorldPosition(tmpFollowerWorld);
      const homeDist = Math.hypot(p.x - entry.homePos.x, p.z - entry.homePos.z);
      if (homeDist <= HOME_ARRIVAL_THRESHOLD) {
        refuel(entry.payload);
        refill(entry.payload);
        entry.returningToBase = false;
        entry.busy = false;
        entry.assignedIncidentId = null;
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────

const dispatchPanel = new DispatchPanel(app, dispatchLoop, {
  getSelectedFollowerId: () => {
    const sel = selection.getSelected() as (FollowerEntry & { id?: number }) | null;
    return sel?.id ?? null;
  },
  onManualDispatch: (incidentId, followerId) => {
    const inc = dispatchLoop.registry.byId(incidentId);
    const entry = followers.find(f => f.id === followerId);
    if (!inc || !entry) return;

    const ok = dispatchLoop.manualDispatch(incidentId, followerId, fireGrid.time);
    if (!ok) return;

    entry.busy = true;
    entry.assignedIncidentId = incidentId;
    entry.returningToBase = false;

    setTargetOnCurrentPath(
      entry as unknown as FollowerEntry,
      path2ds,
      { x: inc.pos.x, z: inc.pos.z },
    );
  },
});

// Seed procedural roads at startup and spawn moving vehicles
reseedRoadsAndVehicles(2);

// Click to ignite under cursor
{
  const ray = new Raycaster();
  const mouse = new Vector2();
  const dom = renderer.domElement;
  // Hover tile debug overlay (lower-left)
  const ensureTileDiv = () => {
    if (!_hoverTileDiv) {
      _hoverTileDiv = document.createElement('div');
      _hoverTileDiv.style.position = 'absolute';
      _hoverTileDiv.style.left = '12px';
      _hoverTileDiv.style.bottom = '12px';
      _hoverTileDiv.style.padding = '6px 8px';
      _hoverTileDiv.style.background = 'rgba(0,0,0,0.5)';
      _hoverTileDiv.style.color = '#e5e7eb';
      _hoverTileDiv.style.whiteSpace = 'pre';
      _hoverTileDiv.style.font = '12px/1.2 system-ui, sans-serif';
      app.appendChild(_hoverTileDiv);
    }
  };
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
  dom.addEventListener('mousemove', (e) => {
    // Record cursor pos; overlay updates at 10 Hz from main loop
    ensureTileDiv();
    _hoverHasMouse = true;
    _hoverMouseX = (e as MouseEvent).clientX;
    _hoverMouseY = (e as MouseEvent).clientY;
  });

  dom.addEventListener('click', (e) => {
    getMouseNDC(e);
    
    // Handle menubar tool modes
    const currentTool = paintSystem?.getCurrentTool() || 'none';
    
    if (currentTool === 'ignite') {
      // Ignite mode - ignite at click location
      igniteFromNDC(mouse.x, mouse.y);
      return;
    }
    
    // Paint tools (water, retardant) are handled by the paint system on mouse down/drag
    if (currentTool === 'water' || currentTool === 'retardant') {
      // Paint system handles these
      return;
    }
    
    // Roads placement when enabled or in roads mode
    if (roadsEnabled || currentTool === 'roads') {
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
          const WE = 0.4, WS = 6.0, WV = 0.5; // weights for elevation, slope, valley bonus (more slope penalty)
          const SLOPE_MAX_TAN = 0.7; // ~35 degrees; block steeper
          const CURV_W = 2.8;       // curvature/turning penalty
          const WG = 14.0;          // grade penalty weight for elevation change along segment
          const costField = {
            width: roadCost.width,
            height: roadCost.height,
            costAt: (x: number, z: number, stepDir: { dx: number; dz: number }, prevDir?: { dx: number; dz: number }) => {
              const i = z * roadCost.width + x;
              const base = 1 + WE * roadCost.elev[i] + WS * roadCost.slope[i] - WV * roadCost.valley[i];
              // Hard block steep terrain
              if (roadCost.slope[i] > SLOPE_MAX_TAN) return Infinity;
              let grade = 0;
              const prevX = x - stepDir.dx;
              const prevZ = z - stepDir.dz;
              if (
                prevX >= 0 && prevZ >= 0 &&
                prevX < roadCost.width && prevZ < roadCost.height
              ) {
                const wxPrev = (prevX + 0.5) * hm.scale;
                const wzPrev = (prevZ + 0.5) * hm.scale;
                const wxCur = (x + 0.5) * hm.scale;
                const wzCur = (z + 0.5) * hm.scale;
                const hPrev = hm.sample(wxPrev, wzPrev);
                const hCur = hm.sample(wxCur, wzCur);
                const horiz = Math.hypot(stepDir.dx, stepDir.dz) * hm.scale;
                if (horiz > 1e-4) {
                  const slope = Math.abs(hCur - hPrev) / horiz;
                  grade = WG * Math.pow(slope, 1.35);
                }
              }
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
              return Math.max(0.05, base + grade + curv);
            }
          };
          const rawPath = aStarPath(costField as any, a, b, { diag: false, heuristic: 'euclid', maxIter: roadCost.width * roadCost.height * 6 });
          const path = makeAngularPath(rawPath);
          if (path.length) {
            roadsVis.addPath(path);
            roadPaths.push(path);
            rasterizePolyline(roadMask, path, 0.9);
            applyRoadMaskToFireGrid(fireGrid, roadMask);
            // Update hydrant placement for new roads
            updateHydrantPlacement(hydrantSystem);
            hydrantVisual.update(hydrantSystem);
            rebuildPath2Ds();
          }
        }
      }
      return;
    }
    // Vehicle selection / move order
    {
      mouse.set(mouse.x, mouse.y);
      ray.setFromCamera(mouse as any, rig.camera);
      const hitFollower = findFollowerHit(ray, followers as FollowerEntry[]);
      if (hitFollower) {
        selection.select(hitFollower);
        return;
      }
      const selected = selection.getSelected();
      if (selected) {
        const hits = ray.intersectObject(chunked.group, true);
        if (hits.length) {
          issueMoveOrder(selected, path2ds, hits[0].point);
          return;
        }
      }
    }
    // Vehicle movement mode no longer supported since we removed grid-based vehicles
    // Ignite when toggle is on
    if (menubar.getIgniteMode()) {
      igniteFromNDC(mouse.x, mouse.y);
    }
  });

  // Old duplicate stats.setActions call removed - functionality moved to menubar

  // Wire menubar actions
  menubar.setActions({
    fire: {
      igniteCenter: () => {
        igniteFromNDC(0, 0);
      },
      setVizMode: (mode) => fireViz.setMode(mode),
      applyWater: (x, z, radius) => {
        if (paintSystem) {
          // This will be called by the paint system
          console.log(`Water applied at (${x}, ${z}) with radius ${radius}`);
        }
      },
      applyRetardant: (x, z, radius) => {
        if (paintSystem) {
          // This will be called by the paint system
          console.log(`Retardant applied at (${x}, ${z}) with radius ${radius}`);
        }
      }
    },
    roads: {
      toggle: (on) => { roadsEnabled = on; if (!on) roadEndpoints = []; },
      clear: () => {
        roadsVis.clear();
        clearRoadMask(roadMask);
        roadPaths = [];
        roadEndpoints = [];
        clearFollowers();
        rebuildPath2Ds();
        updateHydrantPlacement(hydrantSystem);
        hydrantVisual.update(hydrantSystem);
      }
    },
    vehicles: {
      spawn: (type) => {
        // Map menubar vehicle type to VehicleManager enum
        const vehicleType = mapMenubarToVehicleType(type);
        console.log(`Spawning ${type || 'generic'} vehicle (mapped to ${vehicleType})`);
        // Always use Frenet vehicle spawning for UI interactions
        // This provides smooth road-following movement for user-spawned vehicles
        rebuildPath2Ds();
        spawnFollowerAtCamera(vehicleType);
      },
      moveModeToggle: (on) => { vehiclesMoveEnabled = on; },
      clear: () => { 
        // Clear both vehicle systems to ensure complete reset
        // - PathFollower vehicles (primary UI system)
        // - VehiclesManager vehicles (testing/abilities system)
        vehicles.clear(); 
        clearFollowers(); 
      }
    },
    hydrants: {
      toggle: (on) => { hydrantVisual.setVisible(on); },
      update: () => { 
        updateHydrantPlacement(hydrantSystem); 
        hydrantVisual.update(hydrantSystem); 
      },
      clear: () => { 
        clearHydrants(hydrantSystem); 
        hydrantVisual.update(hydrantSystem); 
      }
    },
    config: {
      get: () => worldCfg,
      set: (partial) => { Object.assign(worldCfg, partial); },
      regenerate: () => {
        // Regenerate heightmap and biomes from current config
        hm = generateHeightmap(worldCfg.width, worldCfg.height, 1, worldCfg.noise);
        biomes = computeBiomesTuned(hm, { forestMoistureMin: worldCfg.biomes.forestMoistureMin }, { seed: worldCfg.moisture.seed as any });
        
        // Remove old terrain and rebuild
        scene.remove(chunked.group);
        chunked = buildChunkedTerrain(hm, terrainMat, 32, biomes);
        scene.add(chunked.group);
        
        // Rebuild vegetation
        if (forest.leaves.parent) scene.remove(forest.leaves);
        if (forest.trunks.parent) scene.remove(forest.trunks);
        if (forest.broadLeaves?.parent) scene.remove(forest.broadLeaves);
        if (forest.broadTrunks?.parent) scene.remove(forest.broadTrunks);
        if (shrubs.inst.parent) scene.remove(shrubs.inst);
        if (rocks.inst.parent) scene.remove(rocks.inst);
        
        forest = createForest(hm, biomes, { density: worldCfg.densities.tree, broadleafRatio: worldCfg.densities.broadleafRatio });
        scene.add(forest.leaves);
        scene.add(forest.trunks);
        if (forest.broadLeaves) scene.add(forest.broadLeaves);
        if (forest.broadTrunks) scene.add(forest.broadTrunks);
        
        shrubs = createShrubs(hm, biomes, { density: worldCfg.densities.shrub });
        scene.add(shrubs.inst);
        
        rocks = createRocks(hm, biomes, { density: worldCfg.densities.rock });
        scene.add(rocks.inst);
        
        // Clear existing roads, vehicles, and hydrants from old terrain
        scene.remove(roadsVis.group);
        roadsVis.clear();
        vehicles.clear();
        clearFollowers();
        clearHydrants(hydrantSystem);
        roadEndpoints = [];
        roadPaths = [];

        // Rebuild road-related systems for new terrain
        roadCost = buildTerrainCost(hm);
        roadMask = createRoadMask(hm.width, hm.height);

        // Recreate road visual bound to the new heightmap so ribbons hug regenerated terrain
        roadsVis = new RoadsVisual(hm);
        scene.add(roadsVis.group);

        // Reset hydrant system/visual with the refreshed road mask and heightmap
        const hydrantsVisible = hydrantVisual.group.visible;
        scene.remove(hydrantVisual.group);
        hydrantVisual.dispose();
        hydrantSystem = createHydrantSystem(roadMask, hm.scale);
        hydrantVisual = new HydrantVisual(hm);
        hydrantVisual.setVisible(hydrantsVisible);
        scene.add(hydrantVisual.group);
        
        // Rebuild fire grid and related systems
        fireGrid = buildFireGrid(hm, biomes, { cellSize: hm.scale });
        fireSim = new FireSim(fireGrid, simEnv);
        
        // Update paint system and other references
        if (paintSystem) paintSystem.updateReferences(hm, fireGrid);
        fireViz.updateTerrain?.(hm, chunked.group);
        suppressionDecals.updateTerrain?.(hm);
        fireParticles.updateTerrain?.(hm);
        fireRibbon.updateTerrain?.(hm);
        
        // Update vehicle manager with new terrain references
        vehicles = new VehiclesManager(hm, roadCost, roadMask, 64, roadsVis, fireGrid);
        scene.remove(vehicles.group);
        scene.remove(vehicles.particleGroup);
        scene.add(vehicles.group);
        scene.add(vehicles.particleGroup);
        
        // Regenerate procedural roads and spawn vehicles on new terrain
        reseedRoadsAndVehicles(2);
        
        // Update menubar references
        menubar.setRefs?.({ chunkGroup: chunked.group, forest, shrubs, rocks, fireGrid, followers });
      }
    }
  });
}
