import { Object3D, Raycaster, Vector2, Vector3, Mesh, BoxGeometry, MeshStandardMaterial, Color } from 'three';
import { createRenderer, resizeRenderer } from './core/renderer';
import { createScene } from './core/scene';
import { createCameraRig, resizeCamera } from './core/camera';
import { Loop } from './core/loop';
import { generateHeightmap } from './terrain/heightmap';
import { createTerrainMaterial } from './terrain/material';
import { computeBiomes, applyBiomeVertexColors } from './terrain/biomes';
import { buildChunkedTerrain } from './terrain/chunks';
import { buildTerrainCost } from './roads/cost';
import { RoadsVisual } from './roads/visual';
import { createRoadMask, rasterizePolyline } from './roads/state';
import { VehiclesManager, VehicleType } from './vehicles/vehicles';
import { RTSOrbitCamera } from './core/rtsOrbit';

const app = document.body;
const scene = createScene();
const rig = createCameraRig(app);
scene.add(rig.root);

const renderer = createRenderer(app);

// Small flat terrain optimized for particle testing
const hm = generateHeightmap(16, 16, 1, {
  seed: 'particles',
  frequency: 0.1,
  amplitude: 0.1,
  octaves: 1,
  persistence: 0.5,
});

const biomes = computeBiomes(hm);
const terrainMat = createTerrainMaterial() as any;
const chunked = buildChunkedTerrain(hm, terrainMat, 16);
scene.add(chunked.group);

const terrainObj = chunked.group as Object3D;
const orbit = new RTSOrbitCamera(
  renderer.domElement,
  rig.camera,
  terrainObj,
  (x, z) => hm.sample(x, z),
  new Vector3((hm.width * hm.scale) / 2, 5, (hm.height * hm.scale) / 2) // Start elevated for better view
);

// Create a simple road network for vehicles
const roadCost = buildTerrainCost(hm);
const roadsVis = new RoadsVisual(hm);
scene.add(roadsVis.group);
const roadMask = createRoadMask(hm.width, hm.height);

// Create a simple cross-shaped road pattern
const centerX = Math.floor(hm.width / 2);
const centerZ = Math.floor(hm.height / 2);
const roadPaths = [
  // Horizontal road
  [
    { x: 2, z: centerZ },
    { x: hm.width - 3, z: centerZ }
  ],
  // Vertical road
  [
    { x: centerX, z: 2 },
    { x: centerX, z: hm.height - 3 }
  ]
];

for (const path of roadPaths) {
  roadsVis.addPath(path);
  rasterizePolyline(roadMask, path, 0.9);
}

// Create vehicles manager with enhanced particle settings
const vehicles = new VehiclesManager(hm, roadCost, roadMask, 32, roadsVis);
scene.add(vehicles.group);
scene.add(vehicles.particleGroup);

// UI Controls
let movementEnabled = false;
let particleScale = 1.0;
let particleRate = 1.0;

const statsDiv = document.getElementById('stats')!;
const spawnCarBtn = document.getElementById('spawn-car')!;
const spawnFiretruckBtn = document.getElementById('spawn-firetruck')!;
const spawnHelicopterBtn = document.getElementById('spawn-helicopter')!;
const spawnBulldozerBtn = document.getElementById('spawn-bulldozer')!;
const clearAllBtn = document.getElementById('clear-all')!;
const toggleMovementBtn = document.getElementById('toggle-movement')!;
const increaseSizeBtn = document.getElementById('increase-size')!;
const decreaseSizeBtn = document.getElementById('decrease-size')!;
const increaseRateBtn = document.getElementById('increase-rate')!;
const decreaseRateBtn = document.getElementById('decrease-rate')!;

// Enhanced particle spawning method for testbed
(vehicles as any).setParticleSettings = function(scale: number, rate: number) {
  this.particleScale = scale;
  this.particleRate = rate;
};

// Override the particle spawning method for better visibility in testbed
(vehicles as any).spawnParticlesFromVehicles = function(dt: number) {
  const spawnInterval = 0.05 / (this.particleRate || 1.0); // Adjustable rate
  if (this.elapsed % spawnInterval < dt) {
    for (let i = 0; i < this.agents.length; i++) {
      const agent = this.agents[i];
      
      const baseScale = this.particleScale || 1.0;
      const pos = {
        x: agent.pos.x + (Math.random() - 0.5) * 0.5,
        y: agent.pos.y + 0.15,
        z: agent.pos.z + (Math.random() - 0.5) * 0.5
      };
      
      const vel = {
        x: (Math.random() - 0.5) * 3.0,
        y: Math.random() * 2.0 + 1.0,
        z: (Math.random() - 0.5) * 3.0
      };
      
      switch (agent.vehicleType) {
        case VehicleType.FIRETRUCK:
          // Enhanced water spray particles
          this.waterParticles.spawnOne({
            pos,
            vel: { x: vel.x * 0.8, y: vel.y * 0.6, z: vel.z * 0.8 },
            life: 3.0,
            size0: this.cellSize * 0.08 * baseScale,
            size1: this.cellSize * 0.25 * baseScale,
            color0: [0.3, 0.6, 1.0], // Blue
            color1: [0.9, 0.95, 1.0] // White
          });
          break;
          
        case VehicleType.HELICOPTER:
        case VehicleType.AIRPLANE:
          // Enhanced smoke particles
          this.smokeParticles.spawnOne({
            pos: { x: pos.x, y: pos.y + 0.5, z: pos.z },
            vel: { x: vel.x * 0.4, y: vel.y * 1.2, z: vel.z * 0.4 },
            life: 4.0,
            size0: this.cellSize * 0.06 * baseScale,
            size1: this.cellSize * 0.3 * baseScale,
            color0: [0.2, 0.2, 0.2], // Dark gray
            color1: [0.7, 0.7, 0.7]  // Light gray
          });
          break;
          
        case VehicleType.CAR:
        case VehicleType.BULLDOZER:
        case VehicleType.FIREFIGHTER:
        default:
          // Enhanced dust particles
          this.dustParticles.spawnOne({
            pos,
            vel: { x: vel.x * 0.4, y: vel.y * 0.4, z: vel.z * 0.4 },
            life: 2.0,
            size0: this.cellSize * 0.04 * baseScale,
            size1: this.cellSize * 0.15 * baseScale,
            color0: [0.9, 0.7, 0.5], // Light tan
            color1: [0.6, 0.4, 0.2]  // Brown
          });
          break;
      }
    }
  }
};

// Event handlers
spawnCarBtn.onclick = () => {
  vehicles.spawnAt(centerX - 2, centerZ, VehicleType.CAR);
};

spawnFiretruckBtn.onclick = () => {
  vehicles.spawnAt(centerX + 2, centerZ, VehicleType.FIRETRUCK);
};

spawnHelicopterBtn.onclick = () => {
  vehicles.spawnAt(centerX, centerZ - 2, VehicleType.HELICOPTER);
};

spawnBulldozerBtn.onclick = () => {
  vehicles.spawnAt(centerX, centerZ + 2, VehicleType.BULLDOZER);
};

clearAllBtn.onclick = () => {
  vehicles.clear();
};

toggleMovementBtn.onclick = () => {
  movementEnabled = !movementEnabled;
  toggleMovementBtn.textContent = `Movement: ${movementEnabled ? 'On' : 'Off'}`;
  if (movementEnabled) {
    // Set destinations to make vehicles move in circles
    vehicles.setDestinationAll(centerX + 3, centerZ + 3);
  }
};

increaseSizeBtn.onclick = () => {
  particleScale = Math.min(3.0, particleScale * 1.5);
  (vehicles as any).setParticleSettings(particleScale, particleRate);
};

decreaseSizeBtn.onclick = () => {
  particleScale = Math.max(0.3, particleScale / 1.5);
  (vehicles as any).setParticleSettings(particleScale, particleRate);
};

increaseRateBtn.onclick = () => {
  particleRate = Math.min(5.0, particleRate * 1.5);
  (vehicles as any).setParticleSettings(particleScale, particleRate);
};

decreaseRateBtn.onclick = () => {
  particleRate = Math.max(0.2, particleRate / 1.5);
  (vehicles as any).setParticleSettings(particleScale, particleRate);
};

// Initialize settings
(vehicles as any).setParticleSettings(particleScale, particleRate);

// Game loop
const loop = new Loop();
loop.add((dt) => {
  // Simple WASD controls
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
    yawL: (window as any).keyDown('q'),
    yawR: (window as any).keyDown('e'),
    tiltU: (window as any).keyDown('r'),
    tiltD: (window as any).keyDown('f'),
  };

  orbit.update(dt, move);
  const camPos = rig.camera.getWorldPosition(new Vector3());
  chunked.updateLOD(camPos.x, camPos.z);
  
  // Update vehicles and particles
  vehicles.update(dt);
  
  // Update stats
  const particleCount = (vehicles as any).smokeParticles.aliveCount + 
                       (vehicles as any).dustParticles.aliveCount + 
                       (vehicles as any).waterParticles.aliveCount;
  statsDiv.textContent = `FPS: ${Math.round(1/dt)} | Particles: ${particleCount} | Scale: ${particleScale.toFixed(1)} | Rate: ${particleRate.toFixed(1)}`;
  
  renderer.render(scene, rig.camera);
});

// Handle window resize
window.addEventListener('resize', () => {
  resizeRenderer(renderer);
  resizeCamera(rig.camera, renderer);
});

loop.start();