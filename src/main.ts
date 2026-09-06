import { Object3D, PerspectiveCamera, Vector3, Quaternion, Raycaster, Vector2, BufferGeometry, Float32BufferAttribute, Line, LineBasicMaterial } from 'three';
import { createRenderer, resizeRenderer, createComposer, resizeComposer, type ComposerRig } from './core/renderer';
import { createEnvironment } from './core/environment';
import { createScene } from './core/scene';
import { Loop } from './core/loop';
import { attachInput } from './core/input';
import { generateHeightmap } from './terrain/heightmap';
import { worldToGridCell } from './terrain/coordinates';
import { createTerrainMaterial } from './terrain/material';
import { CameraController } from './core/cameraController';
import { computeBiomesTuned } from './terrain/biomes';
import { createVegetationClearance } from './actors/clearance';
import { createForest } from './actors/trees';
import { createShrubs } from './actors/shrubs';
import { createRocks } from './actors/rocks';
import { buildChunkedTerrain } from './terrain/chunks';
// import { attachStats } from './ui/debug'; // Removed - functionality moved to menubar
import { installGlobalErrorOverlay } from './ui/errorOverlay';
import { createMenubar } from './ui/menubar';
import { createPaintSystem } from './ui/paint';
import { buildFireGrid, ignite as igniteTiles, FireState, applyWaterAoE, applyRetardantLine, applyWaterAoEWithHydrants, writeFirelineEdges, fuelKeyOf } from './fire/grid';
import { createFirelineOverlay } from './fire/firelineOverlay';
import { countFireFootprint, createScenarioRunner, type ScenarioDef, type ScenarioResult, type ScenarioRunner } from './scenarios/scenario';
import { createEventSystem, createRng, type EventSystem, type GameEvent } from './events/events';
import { generateBuildings, updateBuildingStates, reportStructures, computeStructureScore, type Building, type StructureReport } from './buildings/buildings';
import { BuildingsVisual } from './buildings/visual';
import { defaultContainmentScenario } from './scenarios/containment';
import { FireSim } from './fire/sim';
import type { Env as FireEnv } from './fire/sim';
import { createFireViz } from './fire/viz';
import { createFireRibbon } from './particles/ribbon';
import { createFlipbookParticles } from './particles/flipbook';
import { createEmbers } from './particles/embers';
import { createSuppressionDecals } from './fire/decals';
import { createHydrantSystem, updateHydrantPlacement, clearHydrants, findActiveHydrantById, findActiveHydrantWithinReach } from './fire/hydrants';
import { HydrantVisual } from './fire/hydrantVisual';
import { createHydrantCoverageRings } from './fire/hydrantCoverage';
import { buildTerrainCost } from './roads/cost';
import { RoadsVisual } from './roads/visual';
import { applyRoadMaskToFireGrid, clearRoadMask, createRoadMask, rasterizePolyline } from './roads/state';
import { generateProceduralRoads } from './roads/procedural';
import { buildPlannedRoadPath } from './roads/planner';
import { VehiclesManager, VehicleType as VManagerVehicleType, VehicleFxState } from './vehicles/vehicles';
import { createVehicleMesh, CIVILIAN_STYLES, CIVILIAN_COLORS, type CivilianStyle, type VehicleMeshOptions } from './vehicles/meshes';
import { createPayload, tickFuel, needsReturnToBase, consumeWater, refuel, refill, LOW_FUEL_FRACTION, type PayloadState } from './vehicles/payload';
import { Path2D } from './paths/path2d';
import { createTurnRouter, type TurnRoute } from './vehicles/turnRouting';
import { PathFollower } from './vehicles/frenet';
import { IntersectionManager, IntersectionInfo } from './vehicles/intersectionManager';
import { assignPathLeaders } from './vehicles/trafficSpacing';
import { canSetTargetOnCurrentPath, createFollowerSelection, findFollowerHit, isOffroadOrderType, issueMoveOrder, setTargetOnCurrentPath, updateOffroadFollowers, type FollowerEntry } from './vehicles/followerOrders';
import { mapMenubarToVehicleType } from './vehicles/menubarMapping';
import { createIncidentRegistry } from './dispatch/incident';
import { createDispatchLoop, type FollowerRef } from './systems/dispatchLoop';
import { DispatchPanel } from './ui/dispatchPanel';
import { createVehicleHud, type HydrantStatus } from './ui/vehicleHud';

// Config and console system
import { isFeatureEnabled } from './config/features';
import { DebugConsole } from './ui/console';
import { getLogger } from '../tools/logging/index.js';

declare global {
  interface Window {
    advanceTime?: (ms: number) => void;
    render_game_to_text?: () => string;
    __wildfireTestApi?: {
      getState: () => ReturnType<typeof buildGameState>;
      advanceTime: (ms: number) => void;
      igniteCenter: () => boolean;
      igniteTile: (x: number, z: number, intensity?: number) => boolean;
      clearFire: () => void;
      addRoad: (ax: number, az: number, bx: number, bz: number) => boolean;
      clearRoads: () => void;
      setupTrafficScenario: () => boolean;
      spawnVehicle: (type?: 'generic' | 'firetruck' | 'bulldozer' | 'helicopter' | 'airplane' | 'firefighter') => boolean;
      findOffroadBurnableTiles: (minDistFromRoad: number, count: number) => Array<{ x: number; z: number }>;
      clearVehicles: () => void;
      selectFollower: (id: number) => boolean;
      orderFollowerTo: (id: number, x: number, z: number) => boolean;
      applyWaterAt: (x: number, z: number, radius?: number, intensity?: number) => void;
      applyWaterFromHydrantAt: (x: number, z: number, radius?: number, intensity?: number) => void;
      applyRetardantAt: (x: number, z: number, radius?: number, intensity?: number) => void;
      updateHydrants: () => void;
      setAutoDispatch: (on: boolean) => void;
      canManualDispatch: (incidentId: number, followerId: number) => boolean;
      manualDispatch: (incidentId: number, followerId: number) => boolean;
      getTileAt: (x: number, z: number) => {
        x: number;
        z: number;
        state: string;
        heat: number;
        wetness: number;
        retardant: number;
        lineStrength: number;
      } | null;
      exhaustFollowerWater: (id: number) => boolean;
      setHydrantActive: (id: number, active: boolean) => boolean;
      removeHydrant: (id: number) => boolean;
      loadScenario: (def?: ScenarioDef) => { id: string; containmentBudget: number; timeLimitSec: number };
      getScenarioResult: () => { id: string; result: ScenarioResult; elapsedSec: number; footprint: number; budget: number; timeLimitSec: number; structures: StructureReport; score: number } | null;
      clearScenario: () => void;
      setRandomEvents: (on: boolean, seed?: string) => void;
      getEventLog: () => GameEvent[];
      getBuildings: () => StructureReport & {
        buildings: Array<{ id: number; kind: string; state: string; x: number; z: number }>;
      };
    };
  }
}

// Initialize logging for application startup
const logger = getLogger();
logger.info('Wildfire RTS application starting');

const app = document.getElementById('app')!;

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
// Generated before the scene so the sun's shadow frustum can be sized to the
// actual play area.
let hm = generateHeightmap(worldCfg.width, worldCfg.height, 1, worldCfg.noise);

const worldCenterX = (hm.width * hm.scale) / 2;
const worldCenterZ = (hm.height * hm.scale) / 2;
const shadowExtent = Math.max(hm.width, hm.height) * hm.scale * 0.75;
const scene = createScene({ worldCenter: { x: worldCenterX, z: worldCenterZ }, shadowExtent });

// Visual overhaul: sky dome + fog/light retuning. The dome half extent must
// stay inside the camera far plane (the perspective camera below is created
// with far = 2000), so the radius is bounded accordingly.
createEnvironment(scene, {
  worldRadius: 900,
  sunLight: (scene.children.find((c) => (c as any).isDirectionalLight) as any) ?? undefined,
  hemiLight: (scene.children.find((c) => (c as any).isHemisphereLight) as any) ?? undefined,
});

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

// Biomes and material
let biomes = computeBiomesTuned(hm, { forestMoistureMin: worldCfg.biomes.forestMoistureMin }, { seed: worldCfg.moisture.seed as any });
const terrainMat = createTerrainMaterial() as any;

// Stage G: chunked terrain with basic LOD
let chunked = buildChunkedTerrain(hm, terrainMat, 32, biomes);
scene.add(chunked.group);

// Stage C: RTS camera controller (true spherical orbit, damped)
const camera = new PerspectiveCamera(60, app.clientWidth / app.clientHeight, 0.1, 2000);
const _groundRay = new Raycaster();
const _groundNdc = new Vector2();
const cam = new CameraController(renderer.domElement, camera, {
  bounds: { minX: 0, maxX: hm.width * hm.scale, minZ: 0, maxZ: hm.height * hm.scale },
  sampleHeight: (x, z) => hm.sample(x, z),
  projectGround: (nx, ny) => {
    _groundRay.setFromCamera(_groundNdc.set(nx, ny), cam.camera);
    const hit = _groundRay.intersectObject(chunked.group, true)[0];
    return hit ? { x: hit.point.x, z: hit.point.z } : null;
  },
  initialTarget: { x: (hm.width * hm.scale) / 2, z: (hm.height * hm.scale) / 2 },
});

// Post-processing: RenderPass -> subtle bloom -> OutputPass. ?nofx=1 (perf
// probes / software-GL audits) or a missing WebGL2 context falls back to the
// plain renderer.render path.
const nofx = new URLSearchParams(window.location.search).get('nofx') === '1';
let post: ComposerRig | null = nofx ? null : createComposer(renderer, scene, cam.camera);

const loop = new Loop();
let suppressRenderDuringAdvance = false;
const tmpCamWorld = new Vector3();
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

  cam.update(dt, move);
  if (vegetationDirty) refreshVegetationClearance();
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
  const camPos = cam.camera.getWorldPosition(tmpCamWorld);
  chunked.updateLOD(camPos.x, camPos.z);
  // Random events (lightning, wind shifts) mutate simEnv before the fire step.
  eventSystem.tick(dt, fireGrid, simEnv, (tile, heat) => igniteTiles(fireGrid, [tile], heat));
  // Simulate fire at fixed steps and update visualization
  fireSim.step(dt);
  if (activeScenario && activeScenario.result === 'pending') {
    activeScenario.tick(dt, countFireFootprint(fireGrid));
  }
  fireViz.update(fireGrid, dt);
  // Water/retardant decals and fireline overlay rebuild from full-grid scans;
  // their content changes slowly, so 5 Hz is indistinguishable and saves three
  // 16k-tile sweeps per frame.
  overlayScanAcc += dt;
  if (overlayScanAcc >= 0.2) {
    overlayScanAcc = 0;
    suppressionDecals.update(fireGrid);
    firelineOverlay.update(fireGrid);
  }
  // Building fire states + tint at 2 Hz — cheap, and state changes are slow.
  buildingStateAcc += dt;
  if (buildingStateAcc >= 0.5) {
    buildingStateAcc = 0;
    updateBuildingStates(buildings, fireGrid);
    buildingsVisual.update(buildings);
  }

  // Dispatch loop — detect incidents, auto-assign, promote/resolve
  {
    if (followerRefsDirty) rebuildFollowerRefs();
    // Sync mutable per-frame fields into the pooled refs (index-aligned).
    for (let i = 0; i < followerRefPool.length; i++) {
      const f = followers[i];
      const ref = followerRefPool[i];
      ref.busy = f.busy;
      ref.waterRemaining = f.payload.water;
    }
    dispatchLoop.tick(dt, fireGrid.time, fireGrid, followerRefPool, path2ds);
    // Sync busy flag back from followerRefs (dispatch loop may have updated it)
    for (let i = 0; i < followerRefPool.length; i++) {
      const f = followers[i];
      if (f.busy !== followerRefPool[i].busy) f.busy = followerRefPool[i].busy;
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
    _hoverRay.setFromCamera(_hoverMouse as any, cam.camera);
    const hits = _hoverRay.intersectObject(chunked.group, true);
    if (hits.length) {
      const p = hits[0].point;
      const { x: gx, z: gz } = worldToGridCell(hm, p.x, p.z);
      const idx = gz * fireGrid.width + gx;
      const st0 = fireGrid.state[idx];
      const stateName = ['Unburned','Igniting','Burning','Smoldering','Burned'][st0] || String(st0);
      const th = fireGrid.params.thresholds;
      const windDeg = ((simEnv.windDirRad * 180 / Math.PI) % 360 + 360) % 360;
      const lines =
        `Tile ${gx},${gz}  Fuel ${fuelKeyOf(fireGrid, idx)}\n` +
        `State ${stateName}  Heat ${fireGrid.heat[idx].toFixed(2)}  Prog ${fireGrid.progress[idx].toFixed(2)}\n` +
        `Moist ${fireGrid.fuelMoisture[idx].toFixed(2)}  Wet ${fireGrid.wetness[idx].toFixed(2)}  Ret ${fireGrid.retardant[idx].toFixed(2)}  Line ${fireGrid.lineStrength[idx].toFixed(2)}\n` +
        `SlopeTan ${fireGrid.slopeTan[idx].toFixed(2)}  Wind ${simEnv.windSpeed.toFixed(1)} m/s @ ${windDeg.toFixed(0)}°\n` +
        `Thresh: ExtinguishHeat ${th.extinguishHeat.toFixed(2)}  CrownHeat ${th.crownHeat.toFixed(2)}`;
      if (_hoverTileDiv) _hoverTileDiv.textContent = lines;
    } else {
      if (_hoverTileDiv) _hoverTileDiv.textContent = '';
    }
  }
  // Update perimeter ribbon
  fireRibbon.update(fireGrid as any, performance.now() / 1000);
  // Update flipbook particles with real wind from simEnv
  fireParticles.update(fireGrid as any, simEnv, dt, cam.camera);
  // Additive embers drift off the burning frontier (same wind env)
  embers.update(fireGrid as any, simEnv, dt, cam.camera);
  
  // Always update Frenet followers with intersection-aware speed control
  const groups = new Map<Path2D, number[]>();
  updateOffroadFollowers(followers as FollowerEntry[], hm, dt);
  // Bulldozers cut firebreaks as they traverse off-road — write lineStrength
  // at the tile under each moving bulldozer.
  for (const entry of followers) {
    if (entry.type !== VManagerVehicleType.BULLDOZER) continue;
    if (!entry.offroadTarget) continue;
    const pos = entry.object.getWorldPosition(tmpFollowerWorld);
    const gx = Math.floor(pos.x / hm.scale);
    const gz = Math.floor(pos.z / hm.scale);
    if (gx < 0 || gz < 0 || gx >= fireGrid.width || gz >= fireGrid.height) continue;
    writeFirelineEdges(fireGrid, [{ x: gx, z: gz }], 1.0);
  }
  for (let i = 0; i < followers.length; i++) {
    // Off-road order types (bulldozer, firefighter, aircraft) are never driven
    // via the path follower — once an offroadTarget is cleared on arrival, a
    // path update would snap the unit back onto its spawn path.
    if (isOffroadOrderType(followers[i].type)) continue;
    const p = followers[i].follower.path as Path2D;
    if (!groups.has(p)) groups.set(p, []);
    groups.get(p)!.push(i);
  }
  for (const [path, idxs] of groups) {
    leaderScratch.length = 0;
    for (const idx of idxs) leaderScratch.push(followers[idx].follower);
    assignPathLeaders(path, leaderScratch);
    for (const idx of idxs) followers[idx].follower.setSpacingMode(spacingMode);
  }
  controlledView.length = 0;
  let nControlled = 0;
  for (const [path, idxs] of groups) {
    for (const idx of idxs) {
      const f = followers[idx];
      let slot = controlledStorage[nControlled];
      if (!slot) {
        slot = { id: f.id, follower: f.follower, path };
        controlledStorage.push(slot);
      }
      slot.id = f.id;
      slot.follower = f.follower;
      slot.path = path;
      controlledView.push(slot);
      nControlled++;
    }
  }
  intersectionManager.updateBeforeMovement(controlledView, dt);
  for (const idxs of groups.values()) {
    for (const idx of idxs) {
      const current = followers[idx].follower;
      current.update(dt);
      intersectionManager.postUpdateFollower(current, current.path);
      const route = followers[idx].turnRoute;
      if (route && current.path === route.path && current.s >= route.clearS - 1e-3) {
        current.path = route.continuationPath;
        current.s = route.continuationS;
        followers[idx].turnRoute = null;
      }
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
    // Yield indicator — show when held at a low speed cap (intersection yield/stop).
    const yieldInd = entry.mesh.userData?.yieldIndicator as Object3D | undefined;
    if (yieldInd) yieldInd.visible = entry.follower.isYielding();
    // Spin helicopter rotors — fast in flight, idle-slow when parked.
    const rotor = entry.mesh.userData?.mainRotor as Object3D | undefined;
    if (rotor) rotor.rotation.y += (entry.follower.v > 0.1 || entry.offroadTarget ? 22 : 2.5) * dt;
    // Flash the light bar while responding; steady dim glow when idle.
    const lightbar = entry.mesh.userData?.lightbar as Object3D | undefined;
    if (lightbar) {
      const responding = entry.busy || entry.returningToBase || entry.refillTarget != null;
      const redMat = ((lightbar.children[0] as any)?.material) as { emissiveIntensity: number } | undefined;
      const blueMat = ((lightbar.children[1] as any)?.material) as { emissiveIntensity: number } | undefined;
      if (redMat && blueMat) {
        if (responding) {
          const phase = Math.sin(t * 12);
          redMat.emissiveIntensity = phase > 0 ? 2.5 : 0.15;
          blueMat.emissiveIntensity = phase > 0 ? 0.15 : 2.5;
        } else {
          redMat.emissiveIntensity = 0.5;
          blueMat.emissiveIntensity = 0.5;
        }
      }
    }
    updateHydrantLink(entry);
    followerFxStates.push(fx);
  }
  vehicles.updateExternalFx(dt, followerFxStates);

  if (!suppressRenderDuringAdvance) {
    if (post) post.composer.render();
    else renderer.render(scene, cam.camera);
  }
  
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
  // Single fleet pass: busy count for the dispatch panel and the selected
  // follower for the unit HUD (previously separate filter/find scans per frame).
  const selId = (selection.getSelected() as (FollowerEntry & { id?: number }) | null)?.id ?? null;
  selectedFollower = null;
  busyFollowerCount = 0;
  for (const f of followers) {
    if (f.busy) busyFollowerCount++;
    if (selId != null && f.id === selId) selectedFollower = f;
  }
  dispatchPanel.update(followers.length, busyFollowerCount);
  // Update selected-unit HUD (fuel, water, assignment status)
  {
    if (!selectedFollower) {
      vehicleHud.render(null);
    } else {
      vehicleHud.render({
        type: String(selectedFollower.type),
        payload: selectedFollower.payload,
        returningToBase: selectedFollower.returningToBase,
        assignedIncidentId: selectedFollower.assignedIncidentId,
        hydrantStatus: selectedFollower.hydrantStatus,
      });
    }
  }
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
let vegetationDirty = false;
let forest = createForest(hm, biomes, { density: worldCfg.densities.tree, broadleafRatio: worldCfg.densities.broadleafRatio });
scene.add(forest.group);

let shrubs = createShrubs(hm, biomes, { density: worldCfg.densities.shrub });
scene.add(shrubs.group);

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
      let burned = 0;
      for (let i = 0; i < fireGrid.state.length; i++) if (fireGrid.state[i] === FireState.Burned) burned++;
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
      fireGrid.state.fill(FireState.Unburned);
      fireGrid.heat.fill(0);
      fireGrid.progress.fill(0);
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
  cam.resize(app.clientWidth, app.clientHeight);
  resizeComposer(post, app.clientWidth, app.clientHeight);
}

window.addEventListener('resize', onResize);
onResize();

// Stage A-L (fire behavior) — initialize grid + viz, click to ignite
let fireGrid = buildFireGrid(hm, biomes, { cellSize: hm.scale });
let simEnv: FireEnv = { windDirRad: 0, windSpeed: 0 };
let fireSim = new FireSim(fireGrid, simEnv);
// Random events — disabled by default; opt-in via menubar or test API.
let eventSystem: EventSystem = createEventSystem('default');
// Procedural structures — generated after roads seed; victims of the fire sim.
let buildings: Building[] = [];
let buildingsVisual = new BuildingsVisual(hm);
scene.add(buildingsVisual.group);
let buildingStateAcc = 0;
// Throttle for full-grid overlay rebuilds (decals, firelines).
let overlayScanAcc = 0;

// Initialize paint system now that fire grid is available
paintSystem = createPaintSystem(renderer.domElement, cam.camera, chunked.group, hm, fireGrid);

// Connect paint system to camera to lock camera movement during painting operations
cam.setInputLockCheck(() => paintSystem?.isActivePainting() || false);

// Fire visualization controller
let fireViz = createFireViz(hm, chunked.group);
fireViz.addToScene(scene as any);
fireViz.setMode('vertex');
// Water and retardant decal overlays
let suppressionDecals = createSuppressionDecals(hm, { offsetY: 0.05, depthTest: false });
suppressionDecals.addToScene(scene);
// Fireline overlay — visualizes bulldozer-cut firebreaks
let firelineOverlay = createFirelineOverlay(hm);
scene.add(firelineOverlay.inst);
// Flipbook billboard particles (flame/smoke)
let fireParticles = createFlipbookParticles(hm);
scene.add((fireParticles as any).group);
// Additive ember sparks lifted from the burning frontier
let embers = createEmbers(hm);
scene.add(embers.group);
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
  mesh: Object3D;
  type: VManagerVehicleType;
  fxState: VehicleFxState;
  payload: PayloadState;
  busy: boolean;
  assignedIncidentId: number | null;
  returningToBase: boolean;
  homePos: { x: number; z: number };
  offroadTarget?: Vector3 | null;
  /** Set while the unit is driving to / refilling at a hydrant. */
  refillTarget: { hydrantId: number; x: number; z: number } | null;
  /** Active source used for direct ground-unit suppression. */
  hydrantSupplyId: number | null;
  hydrantStatus: HydrantStatus;
  hydrantLink: Line;
  /** Civilian body style + paint color; null for service vehicles. */
  style: CivilianStyle | null;
  color: number | null;
  turnRoute: TurnRoute | null;
};

let followers: ActiveFollower[] = [];
let turnRouter = createTurnRouter([]);
let followerIdCounter = 0;
const followerFxStates: VehicleFxState[] = [];

// ── Per-frame scratch state (allocated once, reused every tick) ──────────────
// Dispatch-loop view over `followers`. Rebuilt only when fleet membership
// changes (spawn/clear); busy/water fields are synced per frame without
// reallocating the route closures. Index-aligned with `followers`.
const followerRefPool: FollowerRef[] = [];
let followerRefsDirty = true;
function markFollowerMembershipChanged() {
  followerRefsDirty = true;
}
function rebuildFollowerRefs() {
  followerRefPool.length = 0;
  for (const f of followers) {
    followerRefPool.push({
      id: f.id,
      type: f.type,
      follower: f.follower,
      busy: f.busy,
      waterRemaining: f.payload.water,
      route: (pos) => setTargetOnCurrentPath(f as unknown as FollowerEntry, path2ds, pos),
      canRoute: (pos) => canSetTargetOnCurrentPath(f as unknown as FollowerEntry, path2ds, pos),
    });
  }
  followerRefsDirty = false;
}
// Intersection-manager input, pooled per slot so steady-state frames allocate
// nothing; `controlledView` is the length-clamped array handed to the manager.
const controlledStorage: Array<{ id: number; follower: PathFollower; path: Path2D }> = [];
const controlledView: Array<{ id: number; follower: PathFollower; path: Path2D }> = [];
// Leader list passed to assignPathLeaders (consumed immediately per path).
const leaderScratch: PathFollower[] = [];
// Hoisted per-frame results for the dispatch panel and selection HUD.
let busyFollowerCount = 0;
let selectedFollower: ActiveFollower | null = null;

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

intersectionManager.setCanEnterProbe((follower, info, route) => {
  const exitPath = route?.continuationPath;
  const exitS = route?.continuationS;
  const exitPos = exitPath && exitS != null ? exitPath.sample(exitS).p : info.pos;
  return !followers.some(other => {
    if (other.follower === follower) return false;
    if (other.follower.path === follower.path) {
      let ds = other.follower.s - info.s;
      if (follower.path.closed && ds < 0) ds += follower.path.length;
      if (ds > 0 && ds < INTERSECTION_CLEAR_ZONE) return true;
    }
    if (exitPath && exitS != null && other.follower.path === exitPath) {
      let ds = other.follower.s - exitS;
      if (exitPath.closed && ds < 0) ds += exitPath.length;
      if (ds > 0 && ds < INTERSECTION_CLEAR_ZONE) return true;
    }
    const phase = intersectionManager.getFollowerPhase(other.follower);
    if (phase !== 'entering' && phase !== 'crossing') return false;
    other.object.updateMatrixWorld(true);
    const pos = other.object.getWorldPosition(tmpFollowerWorld);
    return Math.hypot(pos.x - exitPos.x, pos.z - exitPos.z) < INTERSECTION_CLEAR_ZONE;
  });
});

intersectionManager.setTurnRouter((follower, id, info) => {
  const entry = followers.find((candidate) => candidate.id === id);
  if (!entry || entry.type !== VManagerVehicleType.CAR) return null;
  return turnRouter.chooseRoute(follower.path, follower.s, info, id);
});

intersectionManager.setTurnGranted((_follower, id, route) => {
  const entry = followers.find((candidate) => candidate.id === id);
  if (entry) entry.turnRoute = route;
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
    const occurrences: IntersectionInfo[] = [];
    for (const idx of components) {
      const list = rawIntersections[idx] || [];
      for (const inter of list) {
        const projections = path.projectAll({ x: inter.pos.x, z: inter.pos.z }, hm.scale * 0.35);
        for (const projection of projections) {
          if (occurrences.some((entry) => entry.id === inter.id && Math.abs(entry.s - projection.s) <= 1e-3)) continue;
          occurrences.push({ id: inter.id, s: projection.s, pos: { x: inter.pos.x, z: inter.pos.z } });
        }
      }
    }
    const ordered = occurrences.sort((a, b) => a.s - b.s);
    newPaths.push(path);
    newIntersections.push(ordered);
  }
  path2ds = newPaths;
  pathIntersections = newIntersections;
  turnRouter = createTurnRouter(path2ds.map((path, idx) => ({ path, intersections: pathIntersections[idx] || [] })));
  intersectionManager.setPaths(path2ds.map((path, idx) => ({ path, intersections: pathIntersections[idx] || [] })));
}

function refreshVegetationClearance() {
  vegetationDirty = false;
  const exclusionMask = createVegetationClearance(roadMask, buildings);
  const forestVisible = forest.group.visible;
  const shrubsVisible = shrubs.group.visible;
  scene.remove(forest.group, shrubs.group);
  forest.dispose();
  shrubs.dispose();
  forest = createForest(hm, biomes, { density: worldCfg.densities.tree, broadleafRatio: worldCfg.densities.broadleafRatio, exclusionMask });
  shrubs = createShrubs(hm, biomes, { density: worldCfg.densities.shrub, exclusionMask });
  forest.group.visible = forestVisible;
  shrubs.group.visible = shrubsVisible;
  forest.applyFireTint(fireGrid);
  shrubs.applyFireTint(fireGrid);
  scene.add(forest.group, shrubs.group);
  menubar.setRefs?.({ chunkGroup: chunked.group, forest, shrubs, rocks, fireGrid, followers });
}

function applyRoadPaths() {
  vegetationDirty = true;
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
  hydrantCoverageRings.update(hydrantSystem);
  rebuildPath2Ds();
}

function buildRoadBetween(a: { x: number; z: number }, b: { x: number; z: number }) {
  vegetationDirty = true;
  const path = buildPlannedRoadPath(hm, roadCost, a, b);
  if (!path.length) return false;

  roadsVis.addPath(path);
  roadPaths.push(path);
  rasterizePolyline(roadMask, path, 0.9);
  applyRoadMaskToFireGrid(fireGrid, roadMask);
  updateHydrantPlacement(hydrantSystem);
  hydrantVisual.update(hydrantSystem);
  hydrantCoverageRings.update(hydrantSystem);
  rebuildPath2Ds();
  // Keep the latest endpoint for chained road placement instead of growing forever.
  roadEndpoints = [b];
  return true;
}

function clearRoadNetwork() {
  vegetationDirty = true;
  roadsVis.clear();
  clearRoadMask(roadMask);
  roadPaths = [];
  roadEndpoints = [];
  clearFollowers();
  rebuildPath2Ds();
  updateHydrantPlacement(hydrantSystem);
  hydrantVisual.update(hydrantSystem);
  hydrantCoverageRings.update(hydrantSystem);
}

function seedProceduralRoads(count = 2) {
  // Derive the road seed from the world seed so a seeded boot is fully
  // deterministic (terrain, roads, hydrants, vehicle spawn points).
  roadPaths = generateProceduralRoads(hm, {
    count,
    kinds: ['figure8'],
    seed: Math.floor(createRng(`roads:${worldCfg.noise.seed}`)() * 1e9)
  });
  applyRoadPaths();
}

function createFollowerMesh(vehicleType: VManagerVehicleType, meshOpts?: VehicleMeshOptions): Object3D {
  return createVehicleMesh(vehicleType, hm.scale, meshOpts);
}

// Seeded picker for civilian style/color variety, reset on every reseed so a
// seeded boot is deterministic.
let civilianRng = createRng(`civilians:${worldCfg.noise.seed}`);

function nextCivilianLook(): { style: CivilianStyle; color: number } {
  return {
    style: CIVILIAN_STYLES[Math.floor(civilianRng() * CIVILIAN_STYLES.length)],
    color: CIVILIAN_COLORS[Math.floor(civilianRng() * CIVILIAN_COLORS.length)],
  };
}

function spawnFollowerOnPath(p: Path2D, startS: number, vehicleType: VManagerVehicleType) {
  const obj = new Object3D();
  const look = vehicleType === VManagerVehicleType.CAR ? nextCivilianLook() : null;
  const mesh = createFollowerMesh(vehicleType, look ? { civilianStyle: look.style, color: look.color } : undefined);
  obj.add(mesh);
  scene.add(obj);
  const follower = new PathFollower(p, hm, obj, startS);
  if (!isOffroadOrderType(vehicleType)) follower.laneOffset = Math.min(0.35, hm.scale * 0.3);
  follower.setSpacingMode(spacingMode);
  obj.updateMatrixWorld(true);
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
  const hydrantLinkGeometry = new BufferGeometry();
  hydrantLinkGeometry.setAttribute('position', new Float32BufferAttribute(new Float32Array(6), 3));
  const hydrantLink = new Line(
    hydrantLinkGeometry,
    new LineBasicMaterial({ color: 0x55ddff, transparent: true, opacity: 0.8, depthWrite: false }),
  );
  hydrantLink.visible = false;
  // The two endpoints move every frame; bounding-sphere culling would retain
  // stale bounds and can hide the link after the truck moves.
  hydrantLink.frustumCulled = false;
  hydrantLink.renderOrder = 18;
  scene.add(hydrantLink);
  const p0 = obj.getWorldPosition(new Vector3());
  followers.push({
    id, follower, object: obj, mesh, type: vehicleType, fxState,
    payload: createPayload(vehicleType), busy: false, assignedIncidentId: null,
    returningToBase: false, homePos: { x: p0.x, z: p0.z }, offroadTarget: null,
    refillTarget: null, hydrantSupplyId: null, hydrantStatus: 'none', hydrantLink,
    style: look?.style ?? null, color: look?.color ?? null, turnRoute: null,
  });
  markFollowerMembershipChanged();
}

/**
 * Boot fleet per road network: one firetruck, one bulldozer, and a handful of
 * civilian vehicles with seeded style/color variety.
 */
function spawnFollowersOnAllPaths(civiliansPerPath = 3) {
  for (const p of path2ds) {
    const fleet: VManagerVehicleType[] = [
      VManagerVehicleType.FIRETRUCK,
      VManagerVehicleType.BULLDOZER,
      ...Array<VManagerVehicleType>(Math.max(0, civiliansPerPath)).fill(VManagerVehicleType.CAR),
    ];
    for (let k = 0; k < fleet.length; k++) {
      spawnFollowerOnPath(p, (p.length / fleet.length) * k, fleet[k]);
    }
  }
}

function setupTrafficScenario() {
  clearRoadNetwork();
  roadPaths = [
    [{ x: 16, z: 64 }, { x: 112, z: 64 }],
    [{ x: 64, z: 16 }, { x: 64, z: 112 }],
  ];
  applyRoadPaths();
  clearFollowers();
  if (path2ds.length !== 2 || pathIntersections.some((entries) => entries.length !== 1)) return false;

  for (let pathIndex = 0; pathIndex < path2ds.length; pathIndex++) {
    const path = path2ds[pathIndex];
    const stopS = pathIntersections[pathIndex][0].s;
    for (const offset of [5, 12]) {
      spawnFollowerOnPath(path, Math.max(0, stopS - offset), VManagerVehicleType.CAR);
      followers[followers.length - 1].follower.v = 6;
    }
  }
  cam.focus(64.5, 64.5, 18, 24);
  return true;
}
function reseedRoadsAndVehicles(count = 2) {
  seedProceduralRoads(count);
  clearFollowers();
  civilianRng = createRng(`civilians:${worldCfg.noise.seed}`);
  spawnFollowersOnAllPaths(3);
  buildings = generateBuildings(hm, fireGrid, roadMask, String(worldCfg.noise.seed));
  buildingsVisual.update(buildings);
  vegetationDirty = true;
}
function clearFollowers() {
  for (const f of followers) {
    scene.remove(f.object);
    scene.remove(f.hydrantLink);
    f.hydrantLink.geometry.dispose();
    (f.hydrantLink.material as LineBasicMaterial).dispose();
  }
  followers = [];
  followerFxStates.length = 0;
  followerIdCounter = 0;
  markFollowerMembershipChanged();
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
  const camPos = cam.camera.getWorldPosition(new Vector3());
  const start = { x: camPos.x, z: camPos.z };
  let bestIdx = 0, bestDist = Infinity, bestS = 0;
  for (let i = 0; i < path2ds.length; i++) {
    const proj = path2ds[i].project(start);
    if (proj.dist < bestDist) { bestDist = proj.dist; bestS = proj.s; bestIdx = i; }
  }
  const type = vehicleType ?? VManagerVehicleType.CAR;
  spawnFollowerOnPath(path2ds[bestIdx], bestS, type);
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

// Scenario runner (optional) — tracks fire-containment win/loss for a
// loaded scenario. Null until `loadScenario` is called via the test API.
let activeScenario: ScenarioRunner | null = null;
let hydrantVisual = new HydrantVisual(hm);
scene.add(hydrantVisual.group);
hydrantVisual.setVisible(true); // Initially visible
let hydrantCoverageRings = createHydrantCoverageRings(hm);
scene.add(hydrantCoverageRings.inst);

// Dispatch — incident registry + auto-assignment loop + UI panel
const incidentRegistry = createIncidentRegistry(hm.scale);
const dispatchLoop = createDispatchLoop(incidentRegistry, { detectInterval: 1.0, autoDispatch: true });

// ── Suppression & logistics helpers ──────────────────────────────────────────

/** Maximum distance (meters) from an engaged incident at which a unit actively suppresses. */
const SUPPRESSION_RANGE_METERS = 10;

/** Distance (meters) from home position at which a returning unit is considered arrived. */
const HOME_ARRIVAL_THRESHOLD = 6;

/** Distance (meters) from a hydrant within which a ground unit can draw water. */
const HYDRANT_DRAW_RADIUS = 6;

/** Hydrant water transfer rate, liters/sec. A 4000 L tank fills in ~10 s. */
const HYDRANT_REFILL_RATE = 400;

/** Maximum direct hydrant flow used after a ground unit's tank is exhausted. */
const HYDRANT_SUPPLY_RATE = 400;

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

function sendFollowerHome(entry: ActiveFollower, hydrantStatus: HydrantStatus = 'none') {
  if (!entry.returningToBase && entry.assignedIncidentId != null) {
    dispatchLoop.registry.reopen(entry.assignedIncidentId);
  }
  entry.assignedIncidentId = null;
  entry.returningToBase = true;
  entry.refillTarget = null;
  entry.hydrantSupplyId = null;
  entry.hydrantStatus = hydrantStatus;
  entry.fxState.sprayingWater = false;
  issueMoveOrder(entry as unknown as FollowerEntry, path2ds, new Vector3(entry.homePos.x, 0, entry.homePos.z));
}

/**
 * Route a water-empty firetruck to the nearest hydrant reachable from its
 * current road. Returns false (caller falls back to home RTB) when no
 * hydrant is serviceable.
 */
function sendFollowerToHydrant(entry: ActiveFollower): boolean {
  const p = entry.object.getWorldPosition(tmpFollowerWorld);
  let best: { hydrantId: number; x: number; z: number } | null = null;
  let bestD = Infinity;
  for (const h of hydrantSystem.hydrants) {
    if (!h.active) continue;
    const pos = { x: h.worldPos.x, z: h.worldPos.z };
    if (!canSetTargetOnCurrentPath(entry as unknown as FollowerEntry, path2ds, pos)) continue;
    const d = Math.hypot(pos.x - p.x, pos.z - p.z);
    if (d < bestD) { bestD = d; best = { hydrantId: h.id, ...pos }; }
  }
  if (!best) return false;
  if (!setTargetOnCurrentPath(entry as unknown as FollowerEntry, path2ds, best)) return false;
  if (entry.assignedIncidentId != null) {
    dispatchLoop.registry.reopen(entry.assignedIncidentId);
  }
  entry.assignedIncidentId = null;
  entry.fxState.sprayingWater = false;
  entry.refillTarget = best;
  entry.hydrantSupplyId = null;
  entry.hydrantStatus = 'en-route';
  return true;
}

function isGroundHydrantUnit(entry: ActiveFollower): boolean {
  return (
    entry.payload.waterCapacity > 0 &&
    entry.type !== VManagerVehicleType.HELICOPTER &&
    entry.type !== VManagerVehicleType.AIRPLANE
  );
}

function updateHydrantLink(entry: ActiveFollower) {
  const sourceId = entry.refillTarget?.hydrantId ?? entry.hydrantSupplyId;
  const source = sourceId == null ? null : findActiveHydrantById(hydrantSystem, sourceId);
  if (!source) {
    entry.hydrantLink.visible = false;
    return;
  }

  const p = entry.object.getWorldPosition(tmpFollowerWorld);
  const positions = entry.hydrantLink.geometry.getAttribute('position') as Float32BufferAttribute;
  positions.setXYZ(0, p.x, p.y + 0.35, p.z);
  positions.setXYZ(1, source.worldPos.x, hm.sample(source.worldPos.x, source.worldPos.z) + 0.35, source.worldPos.z);
  positions.needsUpdate = true;
  entry.hydrantLink.visible = entry.hydrantStatus === 'connected' || entry.hydrantStatus === 'refilling';
}

function updateFollowerSuppression(dt: number) {
  for (const entry of followers) {
    entry.fxState.sprayingWater = false;
    entry.hydrantSupplyId = null;
    if (!entry.refillTarget && !entry.returningToBase) {
      entry.hydrantStatus = 'none';
      if (isGroundHydrantUnit(entry)) {
        const currentPos = entry.object.getWorldPosition(tmpFollowerWorld);
        if (findActiveHydrantWithinReach(hydrantSystem, currentPos, HYDRANT_DRAW_RADIUS)) {
          entry.hydrantStatus = 'nearby';
        }
      }
    }

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

    const requested = litersPerSec * dt;
    let drawn = consumeWater(entry.payload, requested);
    if (isGroundHydrantUnit(entry) && drawn < requested) {
      const source = findActiveHydrantWithinReach(hydrantSystem, pos, HYDRANT_DRAW_RADIUS);
      if (source) {
        const supplied = Math.min(requested - drawn, HYDRANT_SUPPLY_RATE * dt);
        drawn += supplied;
        entry.hydrantSupplyId = source.id;
        entry.hydrantStatus = 'connected';
      }
    }
    if (drawn <= 0) {
      sendFollowerHome(entry, isGroundHydrantUnit(entry) ? 'unavailable' : 'none');
      continue;
    }

    entry.fxState.sprayingWater = true;

    if (entry.type === VManagerVehicleType.AIRPLANE) {
      // Air tanker pass: a retardant line along the flight direction plus a
      // cooling water component so the incident itself can be knocked down.
      const fwd = entry.fxState.forward;
      const fx = Math.abs(fwd.x) + Math.abs(fwd.z) > 1e-3 ? fwd : tmpFollowerForward.set(1, 0, 0);
      const cx = inc.tile.x + 0.5;
      const cz = inc.tile.z + 0.5;
      applyRetardantLine(
        fireGrid,
        [
          { x: cx - fx.x * 2.5, z: cz - fx.z * 2.5 },
          { x: cx + fx.x * 2.5, z: cz + fx.z * 2.5 },
        ],
        3,
        Math.min(0.8, 0.2 + drawn / 2200),
      );
      applyWaterAoE(
        fireGrid,
        { x: cx, z: cz },
        4.5,
        Math.min(0.5, 0.12 + drawn / 1600),
      );
    } else {
      applyWaterAoEWithHydrants(
        fireGrid,
        { x: inc.tile.x + 0.5, z: inc.tile.z + 0.5 },
        2.5,
        Math.min(0.55, 0.15 + drawn / 900),
        hydrantSystem,
      );
    }
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

    const fuelLow =
      entry.payload.fuelCapacity > 0 &&
      entry.payload.fuel / entry.payload.fuelCapacity <= LOW_FUEL_FRACTION;
    const hydrantCanSustain = entry.hydrantSupplyId != null && !fuelLow;
    if (!entry.returningToBase && !entry.refillTarget && !hydrantCanSustain && needsReturnToBase(entry.payload)) {
      const waterEmpty = entry.payload.waterCapacity > 0 && entry.payload.water <= 0;
      // Firetrucks that only need water top up at the nearest hydrant instead
      // of driving all the way home; anything else (or low fuel) goes home.
      const usedHydrant =
        entry.type === VManagerVehicleType.FIRETRUCK && waterEmpty && !fuelLow
          ? sendFollowerToHydrant(entry)
          : false;
      if (!usedHydrant) sendFollowerHome(entry, waterEmpty ? 'unavailable' : 'none');
      continue;
    }

    if (entry.refillTarget) {
      const source = findActiveHydrantById(hydrantSystem, entry.refillTarget.hydrantId);
      if (!source || !canSetTargetOnCurrentPath(
        entry as unknown as FollowerEntry,
        path2ds,
        { x: source.worldPos.x, z: source.worldPos.z },
      )) {
        entry.refillTarget = null;
        sendFollowerHome(entry, 'unavailable');
        continue;
      }
      const p = entry.object.getWorldPosition(tmpFollowerWorld);
      const d = Math.hypot(p.x - entry.refillTarget.x, p.z - entry.refillTarget.z);
      if (d <= HYDRANT_DRAW_RADIUS) {
        entry.hydrantStatus = 'refilling';
        entry.payload.water = Math.min(
          entry.payload.waterCapacity,
          entry.payload.water + HYDRANT_REFILL_RATE * dt,
        );
        if (entry.payload.water >= entry.payload.waterCapacity) {
          entry.refillTarget = null;
          entry.hydrantStatus = 'none';
          entry.busy = false;
          entry.assignedIncidentId = null;
        }
      } else {
        entry.hydrantStatus = 'en-route';
      }
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
        entry.hydrantSupplyId = null;
        entry.hydrantStatus = 'none';
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────

function manualDispatchFollower(incidentId: number, followerId: number): boolean {
  const inc = dispatchLoop.registry.byId(incidentId);
  const entry = followers.find(f => f.id === followerId);
  if (!inc || !entry) return false;

  const routed = setTargetOnCurrentPath(
    entry as unknown as FollowerEntry,
    path2ds,
    { x: inc.pos.x, z: inc.pos.z },
  );
  if (!routed) {
    console.warn('Selected unit cannot service this incident from its current road.');
    return false;
  }

  const ok = dispatchLoop.manualDispatch(incidentId, followerId, fireGrid.time);
  if (!ok) {
    entry.offroadTarget = null;
    entry.follower.clearTarget?.();
    return false;
  }

  entry.busy = true;
  entry.assignedIncidentId = incidentId;
  entry.returningToBase = false;
  return true;
}

function canManualDispatchFollower(incidentId: number, followerId: number): boolean {
  const inc = dispatchLoop.registry.byId(incidentId);
  const entry = followers.find(f => f.id === followerId);
  if (!inc || !entry) return false;
  return canSetTargetOnCurrentPath(
    entry as unknown as FollowerEntry,
    path2ds,
    { x: inc.pos.x, z: inc.pos.z },
  );
}

const dispatchPanel = new DispatchPanel(app, dispatchLoop, {
  getSelectedFollowerId: () => {
    const sel = selection.getSelected() as (FollowerEntry & { id?: number }) | null;
    return sel?.id ?? null;
  },
  canManualDispatch: (incidentId, followerId) => canManualDispatchFollower(incidentId, followerId),
  onManualDispatch: (incidentId, followerId) => {
    manualDispatchFollower(incidentId, followerId);
  },
});

const vehicleHud = createVehicleHud(app);
reseedRoadsAndVehicles(2);

function buildGameState() {
  const selected = selection.getSelected() as (FollowerEntry & { id?: number }) | null;
  const traffic = intersectionManager.getSnapshot();
  const trafficByFollower = new Map(traffic.followers.map((state) => [state.id, state]));
  const roadTileCount = roadMask.mask.reduce((sum, cell) => sum + cell, 0);
  let minimumFollowerGap: number | null = null;
  for (const path of path2ds) {
    const onPath = followers
      .filter((entry) => entry.follower.path === path && !isOffroadOrderType(entry.type))
      .map((entry) => entry.follower.s)
      .sort((a, b) => a - b);
    for (let i = 1; i < onPath.length; i++) {
      const gap = onPath[i] - onPath[i - 1];
      minimumFollowerGap = minimumFollowerGap == null ? gap : Math.min(minimumFollowerGap, gap);
    }
    if (path.closed && onPath.length > 1) {
      const seamGap = onPath[0] + path.length - onPath[onPath.length - 1];
      minimumFollowerGap = minimumFollowerGap == null ? seamGap : Math.min(minimumFollowerGap, seamGap);
    }
  }
  const activeFireTiles: Array<{
    x: number;
    z: number;
    state: string;
    heat: number;
    progress: number;
    wetness: number;
    retardant: number;
  }> = [];
  for (let z = 0; z < fireGrid.height; z++) {
    for (let x = 0; x < fireGrid.width; x++) {
      const ti = z * fireGrid.width + x;
      const tileState = fireGrid.state[ti];
      if (tileState === FireState.Unburned) continue;
      activeFireTiles.push({
        x,
        z,
        state: ['unburned', 'igniting', 'burning', 'smoldering', 'burned', 'cleared'][tileState] ?? String(tileState),
        heat: Number(fireGrid.heat[ti].toFixed(3)),
        progress: Number(fireGrid.progress[ti].toFixed(3)),
        wetness: Number(fireGrid.wetness[ti].toFixed(3)),
        retardant: Number(fireGrid.retardant[ti].toFixed(3)),
      });
      if (activeFireTiles.length >= 16) break;
    }
    if (activeFireTiles.length >= 16) break;
  }

  return {
    coordinateSystem: {
      origin: 'grid 0,0 at world x=0 z=0',
      axes: 'x increases to the right/east, z increases downward/south on the terrain plane',
      units: `grid tiles; 1 tile = ${hm.scale} world units`,
    },
    mode: {
      tool: paintSystem?.getCurrentTool() ?? menubar.getCurrentTool(),
      roadsEnabled,
      igniteMode: menubar.getIgniteMode(),
      vehiclesMoveEnabled,
      paused: false,
    },
    world: {
      elapsed: Number(loop.getElapsed().toFixed(3)),
      fireTime: Number(fireGrid.time.toFixed(3)),
      dimensions: { width: hm.width, height: hm.height, scale: hm.scale },
      wind: {
        dirRad: Number(simEnv.windDirRad.toFixed(3)),
        speed: Number(simEnv.windSpeed.toFixed(3)),
      },
    },
    roads: {
      pathCount: roadPaths.length,
      networkCount: path2ds.length,
      tileCount: roadTileCount,
      intersectionCount: traffic.intersections.length,
      intersections: traffic.intersections,
      pendingEndpoints: roadEndpoints.map((p) => ({ x: p.x, z: p.z })),
    },
    hydrants: {
      count: hydrantSystem.hydrants.length,
      visible: hydrantVisual.group.visible,
      positions: hydrantSystem.hydrants.map((hydrant) => ({
        id: hydrant.id,
        x: hydrant.gridPos.x,
        z: hydrant.gridPos.z,
        coverageRadius: hydrant.coverageRadius,
        active: hydrant.active,
      })),
    },
    fire: {
      burningCount: fireGrid.bCount,
      smolderingCount: fireGrid.sCount,
      activeTiles: activeFireTiles,
    },
    vehicles: {
      selectedId: selected?.id ?? null,
      count: followers.length,
      minimumFollowerGap: minimumFollowerGap == null ? null : Number(minimumFollowerGap.toFixed(2)),
      followers: followers.slice(0, 24).map((entry) => {
        entry.object.updateMatrixWorld(true);
        const pos = entry.object.getWorldPosition(new Vector3());
        return {
          id: entry.id,
          type: String(entry.type).toLowerCase(),
          style: entry.style,
          color: entry.color,
          x: Number(pos.x.toFixed(2)),
          y: Number(pos.y.toFixed(2)),
          z: Number(pos.z.toFixed(2)),
          pathLength: Number(entry.follower.path.length.toFixed(2)),
          s: Number(entry.follower.s.toFixed(2)),
          speed: Number(entry.follower.v.toFixed(2)),
          trafficPhase: trafficByFollower.get(entry.id)?.phase ?? 'cruising',
          intersectionId: trafficByFollower.get(entry.id)?.intersectionId ?? null,
          trafficMovement: trafficByFollower.get(entry.id)?.movement ?? null,
          turning: entry.turnRoute != null,
          busy: entry.busy,
          returningToBase: entry.returningToBase,
          assignedIncidentId: entry.assignedIncidentId,
          hydrantStatus: entry.hydrantStatus,
          hydrantSupplyId: entry.hydrantSupplyId,
          refillTargetHydrantId: entry.refillTarget?.hydrantId ?? null,
          water: Number(entry.payload.water.toFixed(1)),
          fuel: Number(entry.payload.fuel.toFixed(1)),
          offroadTarget: entry.offroadTarget
            ? {
                x: Number(entry.offroadTarget.x.toFixed(2)),
                z: Number(entry.offroadTarget.z.toFixed(2)),
              }
            : null,
        };
      }),
    },
    dispatch: {
      autoDispatch: dispatchLoop.getAutoDispatch(),
      incidents: dispatchLoop.registry.list().map((incident) => ({
        id: incident.id,
        status: incident.status,
        x: incident.tile.x,
        z: incident.tile.z,
        assignedFollowerIds: [...incident.assignedFollowerIds],
      })),
    },
  };
}

function buildGameTextState() {
  return JSON.stringify(buildGameState());
}

window.render_game_to_text = () => buildGameTextState();
window.advanceTime = (ms: number) => {
  const clampedMs = Math.max(0, ms);
  // Preserve deterministic 50 ms simulation chunks, but avoid rendering every
  // intermediate frame under software WebGL during browser audits.
  const steps = Math.max(1, Math.ceil(clampedMs / 50));
  const stepMs = clampedMs / steps;
  suppressRenderDuringAdvance = true;
  for (let i = 0; i < steps; i++) {
    loop.step(stepMs);
  }
  suppressRenderDuringAdvance = false;
  loop.step(0);
};
window.__wildfireTestApi = {
  getState: () => buildGameState(),
  advanceTime: (ms) => window.advanceTime?.(ms),
  igniteCenter: () => {
    igniteTiles(fireGrid, [{ x: Math.floor(hm.width / 2), z: Math.floor(hm.height / 2) }], 0.8);
    return true;
  },
  igniteTile: (x, z, intensity = 0.8) => {
    const gx = Math.max(0, Math.min(hm.width - 1, Math.round(x)));
    const gz = Math.max(0, Math.min(hm.height - 1, Math.round(z)));
    igniteTiles(fireGrid, [{ x: gx, z: gz }], intensity);
    return true;
  },
  clearFire: () => {
    fireGrid.state.fill(FireState.Unburned);
    fireGrid.heat.fill(0);
    fireGrid.progress.fill(0);
    fireGrid.wetness.fill(0);
    fireGrid.retardant.fill(0);
    fireGrid.burning = new Uint32Array(fireGrid.burning.length);
    fireGrid.smoldering = new Uint32Array(fireGrid.smoldering.length);
    fireGrid.bCount = 0;
    fireGrid.sCount = 0;
  },
  addRoad: (ax, az, bx, bz) => buildRoadBetween({ x: ax, z: az }, { x: bx, z: bz }),
  clearRoads: () => clearRoadNetwork(),
  setupTrafficScenario,
  spawnVehicle: (type = 'generic') => {
    rebuildPath2Ds();
    if (!path2ds.length) return false;
    spawnFollowerAtCamera(mapMenubarToVehicleType(type));
    return true;
  },
  findOffroadBurnableTiles: (minDistFromRoad, count) => {
    // Collect road tiles once; then scan for burnable tiles at least
    // minDistFromRoad away from every road tile and 20+ tiles apart.
    const roadTiles: Array<{ x: number; z: number }> = [];
    for (let z = 0; z < roadMask.height; z++) {
      for (let x = 0; x < roadMask.width; x++) {
        if (roadMask.mask[z * roadMask.width + x] === 1) roadTiles.push({ x, z });
      }
    }
    const minD2 = minDistFromRoad * minDistFromRoad;
    const found: Array<{ x: number; z: number }> = [];
    const margin = 6;
    for (let z = margin; z < fireGrid.height - margin && found.length < count; z += 2) {
      for (let x = margin; x < fireGrid.width - margin && found.length < count; x += 2) {
        const fi = z * fireGrid.width + x;
        if (fireGrid.state[fi] !== FireState.Unburned) continue;
        const fk = fuelKeyOf(fireGrid, fi);
        if (fk === 'rock' || fk === 'water' || fk === 'urban') continue;
        if (roadTiles.some((r) => (r.x - x) * (r.x - x) + (r.z - z) * (r.z - z) < minD2)) continue;
        if (found.some((f) => Math.hypot(f.x - x, f.z - z) < 20)) continue;
        found.push({ x, z });
      }
    }
    return found;
  },
  clearVehicles: () => {
    vehicles.clear();
    clearFollowers();
  },
  selectFollower: (id) => {
    const entry = followers.find((f) => f.id === id);
    if (!entry) return false;
    selection.select(entry as unknown as FollowerEntry);
    dispatchPanel.update(followers.length, followers.filter((f) => f.busy).length);
    return true;
  },
  orderFollowerTo: (id, x, z) => {
    const entry = followers.find((f) => f.id === id);
    if (!entry) return false;
    issueMoveOrder(entry as unknown as FollowerEntry, path2ds, new Vector3(x, 0, z));
    return true;
  },
  applyWaterAt: (x, z, radius = 2, intensity = 0.4) => {
    applyWaterAoE(fireGrid, { x, z }, radius, intensity);
  },
  applyWaterFromHydrantAt: (x, z, radius = 2, intensity = 0.4) => {
    applyWaterAoEWithHydrants(fireGrid, { x, z }, radius, intensity, hydrantSystem);
  },
  exhaustFollowerWater: (id) => {
    const entry = followers.find((f) => f.id === id);
    if (!entry) return false;
    entry.payload.water = 0;
    return true;
  },
  setHydrantActive: (id, active) => {
    const hydrant = hydrantSystem.hydrants.find((candidate) => candidate.id === id);
    if (!hydrant) return false;
    hydrant.active = active;
    hydrantVisual.update(hydrantSystem);
    hydrantCoverageRings.update(hydrantSystem);
    return true;
  },
  removeHydrant: (id) => {
    const index = hydrantSystem.hydrants.findIndex((candidate) => candidate.id === id);
    if (index < 0) return false;
    hydrantSystem.hydrants.splice(index, 1);
    hydrantVisual.update(hydrantSystem);
    hydrantCoverageRings.update(hydrantSystem);
    return true;
  },
  getTileAt: (x, z) => {
    const gx = Math.round(x);
    const gz = Math.round(z);
    if (gx < 0 || gz < 0 || gx >= fireGrid.width || gz >= fireGrid.height) return null;
    const gi = gz * fireGrid.width + gx;
    return {
      x: gx,
      z: gz,
      state: ['unburned', 'igniting', 'burning', 'smoldering', 'burned', 'cleared'][fireGrid.state[gi]] ?? String(fireGrid.state[gi]),
      heat: Number(fireGrid.heat[gi].toFixed(3)),
      wetness: Number(fireGrid.wetness[gi].toFixed(3)),
      retardant: Number(fireGrid.retardant[gi].toFixed(3)),
      lineStrength: Number(fireGrid.lineStrength[gi].toFixed(3)),
    };
  },
  applyRetardantAt: (x, z, radius = 1.5, intensity = 0.6) => {
    applyRetardantLine(fireGrid, [{ x, z }, { x: x + 0.01, z: z + 0.01 }], radius, intensity);
  },
  updateHydrants: () => {
    updateHydrantPlacement(hydrantSystem);
    hydrantVisual.update(hydrantSystem);
  hydrantCoverageRings.update(hydrantSystem);
  },
  setAutoDispatch: (on) => {
    dispatchLoop.setAutoDispatch(on);
  },
  canManualDispatch: (incidentId, followerId) => canManualDispatchFollower(incidentId, followerId),
  manualDispatch: (incidentId, followerId) => manualDispatchFollower(incidentId, followerId),
  loadScenario: (def = defaultContainmentScenario) => {
    activeScenario = createScenarioRunner(def);
    for (const ign of def.ignitions) {
      igniteTiles(fireGrid, [{ x: ign.x, z: ign.z }], ign.heat ?? 0.9);
    }
    return { id: def.id, containmentBudget: def.containmentBudget, timeLimitSec: def.timeLimitSec };
  },
  getScenarioResult: () => {
    if (!activeScenario) return null;
    const structures = reportStructures(buildings);
    return {
      id: activeScenario.def.id,
      result: activeScenario.result,
      elapsedSec: Number(activeScenario.elapsedSec.toFixed(2)),
      footprint: countFireFootprint(fireGrid),
      budget: activeScenario.def.containmentBudget,
      timeLimitSec: activeScenario.def.timeLimitSec,
      structures,
      score: computeStructureScore(structures),
    };
  },
  clearScenario: () => {
    activeScenario = null;
  },
  setRandomEvents: (on, seed) => {
    if (seed !== undefined) eventSystem = createEventSystem(seed);
    eventSystem.setEnabled(on);
  },
  getEventLog: () => [...eventSystem.getLog()],
  getBuildings: () => ({
    ...reportStructures(buildings),
    buildings: buildings.map((b) => ({
      id: b.id,
      kind: b.kind,
      state: b.state,
      x: b.tile.x,
      z: b.tile.z,
    })),
  }),
};

if (new URLSearchParams(window.location.search).get('scenario') === 'traffic') {
  setupTrafficScenario();
}

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
    ray.setFromCamera(mouse as any, cam.camera);
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
      ray.setFromCamera(mouse as any, cam.camera);
      const hits = ray.intersectObject(chunked.group, true);
      if (hits.length) {
        const p = hits[0].point;
        const { x: gx, z: gz } = worldToGridCell(hm, p.x, p.z);
        roadEndpoints.push({ x: gx, z: gz });
        if (roadEndpoints.length >= 2) {
          const [a, b] = [roadEndpoints[roadEndpoints.length - 2], roadEndpoints[roadEndpoints.length - 1]];
          buildRoadBetween(a, b);
        }
      }
      return;
    }
    // Vehicle selection / move order
    {
      mouse.set(mouse.x, mouse.y);
      ray.setFromCamera(mouse as any, cam.camera);
      const hitFollower = findFollowerHit(ray, followers as FollowerEntry[]);
      if (hitFollower) {
        selection.select(hitFollower);
        dispatchPanel.update(followers.length, followers.filter((f) => f.busy).length);
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
      },
      toggleRandomEvents: (on) => {
        eventSystem.setEnabled(on);
      }
    },
    graphics: {
      toggleBloom: (on) => {
        if (post) post.bloomPass.enabled = on;
      }
    },
    roads: {
      toggle: (on) => { roadsEnabled = on; if (!on) roadEndpoints = []; },
      clear: () => clearRoadNetwork(),
      toggleDebugDiagnostics: (on) => { roadsVis.setDebugDiagnosticsVisible(on); },
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
      toggleCoverage: (on) => { hydrantCoverageRings.setVisible(on); },
      update: () => { 
        updateHydrantPlacement(hydrantSystem); 
        hydrantVisual.update(hydrantSystem);
        hydrantCoverageRings.update(hydrantSystem); 
      },
      clear: () => { 
        clearHydrants(hydrantSystem); 
        hydrantVisual.update(hydrantSystem);
        hydrantCoverageRings.update(hydrantSystem); 
      }
    },
    config: {
      get: () => worldCfg,
      set: (partial) => { Object.assign(worldCfg, partial); },
      regenerate: () => {
        // Regenerate heightmap and biomes from current config
        hm = generateHeightmap(worldCfg.width, worldCfg.height, 1, worldCfg.noise);
        biomes = computeBiomesTuned(hm, { forestMoistureMin: worldCfg.biomes.forestMoistureMin }, { seed: worldCfg.moisture.seed as any });
        
        // Remove old terrain and rebuild (dispose both LOD geometries per chunk;
        // the shared terrain material stays alive for the new chunks)
        scene.remove(chunked.group);
        chunked.dispose();
        chunked = buildChunkedTerrain(hm, terrainMat, 32, biomes);
        scene.add(chunked.group);

        // Rebuild vegetation — free the old instances' GPU resources first
        if (forest.group.parent) scene.remove(forest.group);
        forest.dispose();
        forest = createForest(hm, biomes, { density: worldCfg.densities.tree, broadleafRatio: worldCfg.densities.broadleafRatio });
        scene.add(forest.group);

        if (shrubs.group.parent) scene.remove(shrubs.group);
        shrubs.dispose();
        shrubs = createShrubs(hm, biomes, { density: worldCfg.densities.shrub });
        scene.add(shrubs.group);

        if (rocks.inst.parent) scene.remove(rocks.inst);
        rocks.dispose();
        rocks = createRocks(hm, biomes, { density: worldCfg.densities.rock });
        scene.add(rocks.inst);

        // Clear existing roads, vehicles, and hydrants from old terrain
        scene.remove(roadsVis.group);
        roadsVis.dispose();
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
        const hydrantCoverageVisible = hydrantCoverageRings.inst.visible;
        scene.remove(hydrantVisual.group);
        hydrantVisual.dispose();
        hydrantSystem = createHydrantSystem(roadMask, hm.scale);
        hydrantVisual = new HydrantVisual(hm);
        hydrantVisual.setVisible(hydrantsVisible);
        scene.add(hydrantVisual.group);
        scene.remove(hydrantCoverageRings.inst);
        hydrantCoverageRings.dispose();
        hydrantCoverageRings = createHydrantCoverageRings(hm);
        hydrantCoverageRings.setVisible(hydrantCoverageVisible);
        scene.add(hydrantCoverageRings.inst);
        
        // Rebuild fire grid and related systems
        fireGrid = buildFireGrid(hm, biomes, { cellSize: hm.scale });
        fireSim = new FireSim(fireGrid, simEnv);
        
        // Update paint system and other references
        if (paintSystem) paintSystem.updateReferences(hm, fireGrid);
        fireViz.updateTerrain?.(hm, chunked.group);
        suppressionDecals.updateTerrain?.(hm);
        fireParticles.updateTerrain?.(hm);
        embers.updateTerrain?.(hm);
        fireRibbon.updateTerrain?.(hm);
        
        // Update vehicle manager with new terrain references. Capture the OLD
        // manager first — its group/particleGroup are the ones actually in the
        // scene, so they must be removed and disposed before the replacement.
        const oldVehicles = vehicles;
        scene.remove(oldVehicles.group);
        scene.remove(oldVehicles.particleGroup);
        oldVehicles.dispose();
        vehicles = new VehiclesManager(hm, roadCost, roadMask, 64, roadsVis, fireGrid);
        scene.add(vehicles.group);
        scene.add(vehicles.particleGroup);
        
        // Rebind buildings visual to the new heightmap before reseeding
        scene.remove(buildingsVisual.group);
        buildingsVisual.dispose();
        buildingsVisual = new BuildingsVisual(hm);
        scene.add(buildingsVisual.group);

        // Regenerate procedural roads and spawn vehicles on new terrain
        reseedRoadsAndVehicles(2);
        
        // Update menubar references
        menubar.setRefs?.({ chunkGroup: chunked.group, forest, shrubs, rocks, fireGrid, followers });
      }
    }
  });
}
