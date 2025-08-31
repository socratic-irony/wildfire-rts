import { Mesh, Object3D, BufferAttribute, Vector3, Raycaster, Vector2 } from 'three';
import { createRenderer, resizeRenderer } from './core/renderer';
import { createScene } from './core/scene';
import { createCameraRig, resizeCamera } from './core/camera';
import { Loop } from './core/loop';
import { generateHeightmap } from './terrain/heightmap';
import { buildTerrainGeometry } from './terrain/mesh';
import { createTerrainMaterial } from './terrain/material';
// import { RTSCameraController } from './core/rtsCamera';
import { RTSOrbitCamera } from './core/rtsOrbit';
import { computeBiomesTuned, type BiomeMask } from './terrain/biomes';
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
// import { createFireTexture } from './fire/texture';

const app = document.getElementById('app')!;
const scene = createScene();
const rig = createCameraRig(app);
scene.add(rig.root);

const renderer = createRenderer(app);

type WorldConfig = {
  width: number; height: number; scale: number;
  noise: { seed: number | string; frequency: number; amplitude: number; octaves: number; persistence: number };
  moisture: { frequency: number; seed: number | string };
  biomes: { forestMoistureMin: number; rockSlopeDeg: number; rockHighHeight: number; rockHighSlopeDeg: number; forestSlopeMax: number };
  densities: { tree: number; broadleafRatio: number; shrub: number; rock: number };
};

let config: WorldConfig = {
  width: 128, height: 128, scale: 1,
  noise: { seed: 42, frequency: 2.0, amplitude: 8, octaves: 4, persistence: 0.5 },
  moisture: { seed: 'moist', frequency: 1.5 },
  biomes: { forestMoistureMin: 0.55, rockSlopeDeg: 35, rockHighHeight: 6, rockHighSlopeDeg: 25, forestSlopeMax: 22 },
  densities: { tree: 0.30, broadleafRatio: 0.4, shrub: 0.15, rock: 0.08 },
};

const terrainMat = createTerrainMaterial() as any;

type World = {
  hm: ReturnType<typeof generateHeightmap>;
  biomes: BiomeMask;
  chunked: ReturnType<typeof buildChunkedTerrain>;
  forest: ReturnType<typeof createForest>;
  shrubs: ReturnType<typeof createShrubs>;
  rocks: ReturnType<typeof createRocks>;
  fireGrid: ReturnType<typeof buildFireGrid>;
  fireSim: FireSim;
  fireViz: ReturnType<typeof createFireViz>;
  roadsVis: RoadsVisual;
  roadMask: ReturnType<typeof createRoadMask>;
  roadCost: ReturnType<typeof buildTerrainCost>;
  vehicles: VehiclesManager;
};

let world: World;

function buildWorld() {
  // Heightmap
  const hm = generateHeightmap(config.width, config.height, config.scale, config.noise);
  // Biomes
  const biomes = computeBiomesTuned(hm, {
    forestMoistureMin: config.biomes.forestMoistureMin,
    rockSlopeDeg: config.biomes.rockSlopeDeg,
    rockHighHeight: config.biomes.rockHighHeight,
    rockHighSlopeDeg: config.biomes.rockHighSlopeDeg,
    forestSlopeMax: config.biomes.forestSlopeMax,
  }, { frequency: config.moisture.frequency, seed: config.moisture.seed as any });

  // Chunks
  const chunked = buildChunkedTerrain(hm, terrainMat, 32, biomes);
  scene.add(chunked.group);

  // Actors
  const forest = createForest(hm, biomes, { density: config.densities.tree, broadleafRatio: config.densities.broadleafRatio });
  scene.add(forest.leaves); scene.add(forest.trunks);
  if (forest.broadLeaves) scene.add(forest.broadLeaves);
  if (forest.broadTrunks) scene.add(forest.broadTrunks);

  const shrubs = createShrubs(hm, biomes, { density: config.densities.shrub });
  scene.add(shrubs.inst);

  const rocks = createRocks(hm, biomes, { density: config.densities.rock });
  scene.add(rocks.inst);

  // Fire
  const fireGrid = buildFireGrid(hm, biomes, { cellSize: hm.scale });
  const fireSim = new FireSim(fireGrid, { windDirRad: 0, windSpeed: 0 });
  const fireViz = createFireViz(hm, chunked.group);
  fireViz.addToScene(scene as any);
  fireViz.setMode('vertex');

  // Roads / vehicles
  const roadCost = buildTerrainCost(hm);
  const roadsVis = new RoadsVisual(hm);
  scene.add(roadsVis.group);
  const roadMask = createRoadMask(hm.width, hm.height);
  const vehicles = new VehiclesManager(hm, roadCost, roadMask, 64);
  scene.add(vehicles.group);

  world = { hm, biomes, chunked, forest, shrubs, rocks, fireGrid, fireSim, fireViz, roadsVis, roadMask, roadCost, vehicles };
}

// Initial world
buildWorld();

// Stage C: RTS camera controller (replaces Orbit)
const terrainObj = world.chunked.group as Object3D;
const orbit = new RTSOrbitCamera(
  renderer.domElement,
  rig.camera,
  terrainObj,
  (x, z) => world.hm.sample(x, z),
  new Vector3((world.hm.width * world.hm.scale) / 2, 0, (world.hm.height * world.hm.scale) / 2)
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
  world.forest?.update(t);
  world.shrubs?.update(t);
  // Update LOD for terrain chunks
  const camPos = rig.camera.getWorldPosition(new Vector3());
  world.chunked.updateLOD(camPos.x, camPos.z);
  // Simulate fire at fixed steps and update visualization
  world.fireSim.step(dt);
  world.fireViz.update(world.fireGrid, dt);
  world.vehicles.update(dt);
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
});

// Attach stats after actors/chunks are created so we can report counts
const stats = attachStats(app, { chunkGroup: world.chunked.group, forest: world.forest, shrubs: world.shrubs, rocks: world.rocks });
loop.start();

function onResize() {
  resizeRenderer(renderer, app);
  resizeCamera(rig, app);
}

window.addEventListener('resize', onResize);
onResize();

// Roads — cost field + visual + input state
let roadsEnabled = false;
let roadEndpoints: Array<{ x: number; z: number }> = [];

// Vehicles move mode
let vehiclesMoveEnabled = false;

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
    const hits = ray.intersectObject(world.chunked.group, true);
    if (!hits.length) return false;
    const p = hits[0].point;
    const gx = Math.floor(p.x / world.hm.scale);
    const gz = Math.floor(p.z / world.hm.scale);
    igniteTiles(world.fireGrid, [{ x: gx, z: gz }], 0.8);
    return true;
  }
  dom.addEventListener('click', (e) => {
    getMouseNDC(e);
    // Roads placement when enabled
    if (roadsEnabled) {
      mouse.set(mouse.x, mouse.y);
      ray.setFromCamera(mouse as any, rig.camera);
      const hits = ray.intersectObject(world.chunked.group, true);
      if (hits.length) {
        const p = hits[0].point;
        const gx = Math.max(0, Math.min(world.hm.width - 1, Math.round(p.x / world.hm.scale)));
        const gz = Math.max(0, Math.min(world.hm.height - 1, Math.round(p.z / world.hm.scale)));
        roadEndpoints.push({ x: gx, z: gz });
        if (roadEndpoints.length >= 2) {
          const [a, b] = [roadEndpoints[roadEndpoints.length - 2], roadEndpoints[roadEndpoints.length - 1]];
          // Build cost function on the fly
          const WE = 0.6, WS = 2.0, WV = 0.8; // weights for elevation, slope, valley bonus (more slope penalty)
          const SLOPE_MAX_TAN = 0.7; // ~35 degrees; block steeper
          const CURV_W = 1.6;       // curvature/turning penalty
          const costField = {
            width: world.roadCost.width,
            height: world.roadCost.height,
            costAt: (x: number, z: number, stepDir: { dx: number; dz: number }, prevDir?: { dx: number; dz: number }) => {
              const i = z * world.roadCost.width + x;
              const base = 1 + WE * world.roadCost.elev[i] + WS * world.roadCost.slope[i] - WV * world.roadCost.valley[i];
              // Hard block steep terrain
              if (world.roadCost.slope[i] > SLOPE_MAX_TAN) return Infinity;
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
          const path = aStarPath(costField as any, a, b, { diag: true, heuristic: 'euclid', maxIter: world.roadCost.width * world.roadCost.height * 6 });
          if (path.length) {
            world.roadsVis.addPath(path);
            rasterizePolyline(world.roadMask, path, 0.9);
            applyRoadMaskToFireGrid(world.fireGrid, world.roadMask);
          }
        }
      }
      return;
    }
    // Vehicle movement when enabled
    if (vehiclesMoveEnabled) {
      mouse.set(mouse.x, mouse.y);
      ray.setFromCamera(mouse as any, rig.camera);
      const hits = ray.intersectObject(world.chunked.group, true);
      if (hits.length) {
        const p = hits[0].point;
        const gx = Math.max(0, Math.min(world.hm.width - 1, Math.round(p.x / world.hm.scale)));
        const gz = Math.max(0, Math.min(world.hm.height - 1, Math.round(p.z / world.hm.scale)));
        world.vehicles.setDestinationAll(gx, gz);
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
    setVizMode: (mode) => world.fireViz.setMode(mode),
    roads: {
      toggle: (on) => { roadsEnabled = on; if (!on) roadEndpoints = []; },
      clear: () => { world.roadsVis.clear(); roadEndpoints = []; }
    },
    vehicles: {
      spawn: () => {
        const camPos = rig.camera.getWorldPosition(new Vector3());
        const gx = Math.max(0, Math.min(world.hm.width - 1, Math.round(camPos.x / world.hm.scale)));
        const gz = Math.max(0, Math.min(world.hm.height - 1, Math.round(camPos.z / world.hm.scale)));
        world.vehicles.spawnAt(gx, gz);
      },
      moveModeToggle: (on) => { vehiclesMoveEnabled = on; },
      clear: () => world.vehicles.clear(),
    },
    config: {
      get: () => JSON.parse(JSON.stringify(config)),
      set: (partial: any) => {
        // Deep merge for known sections
        config = {
          ...config,
          ...('width' in partial ? { width: partial.width, height: partial.height ?? partial.width } : {}),
          noise: { ...config.noise, ...(partial.noise || {}) },
          moisture: { ...config.moisture, ...(partial.moisture || {}) },
          biomes: { ...config.biomes, ...(partial.biomes || {}) },
          densities: { ...config.densities, ...(partial.densities || {}) },
        };
      },
      regenerate: () => {
        // Remove existing world objects from scene
        scene.remove(world.chunked.group);
        scene.remove(world.roadsVis.group);
        scene.remove(world.vehicles.group);
        world.fireViz.removeFromScene(scene as any);
        // Remove actors
        scene.remove(world.forest.leaves);
        scene.remove(world.forest.trunks);
        if (world.forest.broadLeaves) scene.remove(world.forest.broadLeaves);
        if (world.forest.broadTrunks) scene.remove(world.forest.broadTrunks);
        scene.remove(world.shrubs.inst);
        scene.remove(world.rocks.inst);
        // rebuild
        buildWorld();
        // Update stats references
        stats.setRefs?.({ chunkGroup: world.chunked.group, forest: world.forest, shrubs: world.shrubs, rocks: world.rocks });
      }
    }
  });
}
