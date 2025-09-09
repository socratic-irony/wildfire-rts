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
import { applyBiomeVertexColors, computeBiomes, computeBiomesTuned } from './terrain/biomes';
import { createForest } from './actors/trees';
import { createShrubs } from './actors/shrubs';
import { createRocks } from './actors/rocks';
import { buildChunkedTerrain } from './terrain/chunks';
// import { attachStats } from './ui/debug'; // Removed - functionality moved to menubar
import { installGlobalErrorOverlay } from './ui/errorOverlay';
import { createMenubar } from './ui/menubar';
import { createPaintSystem } from './ui/paint';
import { buildFireGrid, ignite as igniteTiles, FireState } from './fire/grid';
import { FireSim } from './fire/sim';
import { createFireViz } from './fire/viz';
import { createFireRibbon } from './particles/ribbon';
import { createFlipbookParticles } from './particles/flipbook';
import { createSuppressionDecals } from './fire/decals';
import { createHydrantSystem, updateHydrantPlacement, clearHydrants } from './fire/hydrants';
import { HydrantVisual } from './fire/hydrantVisual';
import { buildTerrainCost } from './roads/cost';
import { aStarPath } from './roads/astar';
import { RoadsVisual } from './roads/visual';
import { applyRoadMaskToFireGrid, createRoadMask, rasterizePolyline } from './roads/state';
import { VehiclesManager, VehicleType as VManagerVehicleType } from './vehicles/vehicles';
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
  noise: { seed: '42', frequency: 2.0, amplitude: 8, octaves: 4, persistence: 0.5 },
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
  // Periodically apply burn tint to vegetation from fire grid
  vegTintAcc += dt;
  if (vegTintAcc >= 0.5) {
    vegTintAcc = 0;
    forest?.applyFireTint?.(fireGrid as any);
    shrubs?.applyFireTint?.(fireGrid as any);
  }
  // Update LOD for terrain chunks
  const camPos = rig.camera.getWorldPosition(new Vector3());
  chunked.updateLOD(camPos.x, camPos.z);
  // Simulate fire at fixed steps and update visualization
  fireSim.step(dt);
  fireViz.update(fireGrid, dt);
  // Update water and retardant decals
  suppressionDecals.update(fireGrid);
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
  // Update flipbook particles (wind placeholder; can wire simEnv later)
  fireParticles.update(fireGrid as any, { windDirRad: 0, windSpeed: 0 }, dt, rig.camera);
  
  // Always update Frenet followers
  // Intersections TBD — no special slowing logic here
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
  menubar.update(dt, renderer, { chunkGroup: chunked.group, forest, shrubs, rocks, fireGrid });
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
let simEnv = { windDirRad: 0, windSpeed: 0 };
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
menubar.setRefs?.({ chunkGroup: chunked.group, forest, shrubs, rocks, fireGrid });

// Roads — cost field + visual + input state
let roadCost = buildTerrainCost(hm);
let roadsVis = new RoadsVisual(hm);
scene.add(roadsVis.group);
let roadMask = createRoadMask(hm.width, hm.height);
let roadsEnabled = false;
let roadEndpoints: Array<{ x: number; z: number }> = [];
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
  // Treat each smoothed midline as a closed loop if it appears to form a circuit
  path2ds = stitched.map(pts => {
    const first = pts[0];
    const last = pts[pts.length - 1];
    const isClosed = Math.hypot(first.x - last.x, first.z - last.z) < hm.scale * 1.5;
    return new Path2D(pts, { closed: isClosed });
  });
}
function spawnFollowersOnAllPaths(perPath = 3) {
  // Create visible follower objects for each path2d
  for (const p of path2ds) {
    const total = Math.max(1, perPath);
    for (let k = 0; k < total; k++) {
      const obj = new Object3D();
      const geo = new BoxGeometry(hm.scale * 0.6, hm.scale * 0.3, hm.scale * 0.9);
      const mat = new MeshStandardMaterial({ color: new Color(0x1e90ff), roughness: 0.7, metalness: 0.1 });
      const mesh = new Mesh(geo, mat); mesh.castShadow = true; obj.add(mesh);
      scene.add(obj);
      const startS = (p.length / total) * k;
      const follower = new PathFollower(p, hm, obj, startS);
      follower.setSpacingMode(spacingMode);
      followers.push(follower);
    }
  }
}
// Helper: rectangular road loop builder (grid cells around rectangle border)
function buildRectLoop(x0: number, z0: number, x1: number, z1: number) {
  const pts: Array<{ x: number; z: number }> = [];
  for (let x = x0; x <= x1; x++) pts.push({ x, z: z0 });
  for (let z = z0 + 1; z <= z1; z++) pts.push({ x: x1, z });
  for (let x = x1 - 1; x >= x0; x--) pts.push({ x, z: z1 });
  for (let z = z1 - 1; z > z0; z--) pts.push({ x: x0, z });
  return pts;
}
// Seed a few random road loops and spawn vehicles on them
function seedRandomLoopsAndVehicles(count = 2) {
  const pad = Math.max(6, Math.floor(Math.min(hm.width, hm.height) * 0.05));
  const loops: Array<Array<{ x: number; z: number }>> = [];
  for (let n = 0; n < count; n++) {
    const minW = Math.max(10, Math.floor(hm.width * 0.20));
    const minH = Math.max(10, Math.floor(hm.height * 0.20));
    const maxW = Math.max(minW + 6, Math.floor(hm.width * 0.55));
    const maxH = Math.max(minH + 6, Math.floor(hm.height * 0.55));
    const w = Math.min(maxW, minW + Math.floor(Math.random() * (maxW - minW + 1)));
    const h = Math.min(maxH, minH + Math.floor(Math.random() * (maxH - minH + 1)));
    const x0 = pad + Math.floor(Math.random() * Math.max(1, hm.width - w - 2 * pad));
    const z0 = pad + Math.floor(Math.random() * Math.max(1, hm.height - h - 2 * pad));
    const x1 = Math.min(hm.width - 1 - pad, x0 + w);
    const z1 = Math.min(hm.height - 1 - pad, z0 + h);
    const loop = buildRectLoop(x0, z0, x1, z1);
    const closed = loop.concat([loop[0]]);
    loops.push(closed);
    roadsVis.addPath(closed);
    rasterizePolyline(roadMask, closed, 0.9);
  }
  // Apply to fire grid for integration
  applyRoadMaskToFireGrid(fireGrid, roadMask);
  // Update hydrant placement for new roads
  updateHydrantPlacement(hydrantSystem);
  hydrantVisual.update(hydrantSystem);
  rebuildPath2Ds();
  // No longer spawn grid-mode vehicles - only Frenet vehicles are used
}
function clearFollowers() {
  for (const f of followers) scene.remove(f.object);
  followers = [];
}
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
  const geo = new BoxGeometry(hm.scale * 0.6, hm.scale * 0.3, hm.scale * 0.9);
  
  // Create vehicle-specific appearance based on type
  let mat: MeshStandardMaterial;
  switch (vehicleType) {
    case VManagerVehicleType.FIRETRUCK:
      mat = new MeshStandardMaterial({ 
        color: new Color(0xcc0000), 
        roughness: 0.6, 
        metalness: 0.2, 
        emissive: new Color(0x220000), 
        emissiveIntensity: 0.3 
      });
      break;
    case VManagerVehicleType.BULLDOZER:
      mat = new MeshStandardMaterial({ 
        color: new Color(0xffdd00), 
        roughness: 0.8, 
        metalness: 0.3, 
        emissive: new Color(0x332200), 
        emissiveIntensity: 0.2 
      });
      break;
    case VManagerVehicleType.CAR:
    default:
      mat = new MeshStandardMaterial({ color: new Color(0x1e90ff), roughness: 0.7, metalness: 0.1 });
      break;
  }
  
  const mesh = new Mesh(geo, mat); mesh.castShadow = true; obj.add(mesh);
  scene.add(obj);
  const follower = new PathFollower(path2ds[bestIdx], hm, obj, bestS);
  followers.push(follower);
}

// Helper function to map menubar vehicle types to VehicleManager enum values
function mapMenubarToVehicleType(menubarType?: string): VManagerVehicleType | undefined {
  switch (menubarType) {
    case 'firetruck': return VManagerVehicleType.FIRETRUCK;
    case 'bulldozer': return VManagerVehicleType.BULLDOZER;
    case 'waterTender': return VManagerVehicleType.FIRETRUCK; // Water tender mapped to firetruck
    case 'generic': return VManagerVehicleType.CAR;
    default: return VManagerVehicleType.CAR; // Default fallback
  }
}

// Vehicles — manager uses terrain cost and road mask
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

// Seed random road loops at startup and spawn moving vehicles
seedRandomLoopsAndVehicles(2);
rebuildPath2Ds();
spawnFollowersOnAllPaths(3);

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
            // Update hydrant placement for new roads
            updateHydrantPlacement(hydrantSystem);
            hydrantVisual.update(hydrantSystem);
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
      clear: () => { roadsVis.clear(); roadEndpoints = []; clearFollowers(); rebuildPath2Ds(); }
    },
    vehicles: {
      spawn: (type) => {
        // Map menubar vehicle type to VehicleManager enum
        const vehicleType = mapMenubarToVehicleType(type);
        console.log(`Spawning ${type || 'generic'} vehicle (mapped to ${vehicleType})`);
        // Always use Frenet vehicle spawning
        rebuildPath2Ds();
        spawnFollowerAtCamera(vehicleType);
      },
      moveModeToggle: (on) => { vehiclesMoveEnabled = on; },
      clear: () => { vehicles.clear(); clearFollowers(); }
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
        
        // Rebuild fire grid and related systems
        fireGrid = buildFireGrid(hm, biomes, { cellSize: hm.scale });
        fireSim = new FireSim(fireGrid, simEnv);
        
        // Update paint system and other references
        if (paintSystem) paintSystem.updateReferences(hm, fireGrid);
        fireViz.updateTerrain?.(hm, chunked.group);
        suppressionDecals.updateTerrain?.(hm);
        fireParticles.updateTerrain?.(hm);
        fireRibbon.updateTerrain?.(hm);
        
        // Update menubar references
        menubar.setRefs?.({ chunkGroup: chunked.group, forest, shrubs, rocks, fireGrid });
      }
    }
  });
}
