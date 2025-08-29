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
import { applyBiomeVertexColors, computeBiomes } from './terrain/biomes';
import { createForest } from './actors/trees';
import { createShrubs } from './actors/shrubs';
import { buildChunkedTerrain } from './terrain/chunks';
import { attachStats } from './ui/debug';
import { buildFireGrid, ignite as igniteTiles } from './fire/grid';
import { FireSim } from './fire/sim';
import { createFireOverlay } from './fire/overlay';

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
  // Simulate fire at fixed steps and update overlay
  fireSim.step(dt);
  fireOverlay.update(fireGrid);
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

// Stage F: vegetation
const forest = createForest(hm, biomes);
scene.add(forest.leaves);
scene.add(forest.trunks);

const shrubs = createShrubs(hm, biomes);
scene.add(shrubs.inst);

// Attach stats after actors/chunks are created so we can report counts
const stats = attachStats(app, { chunkGroup: chunked.group, forest, shrubs });
loop.start();

function onResize() {
  resizeRenderer(renderer, app);
  resizeCamera(rig, app);
}

window.addEventListener('resize', onResize);
onResize();

// Stage A-L (fire behavior) — initialize grid + overlay, click to ignite
const fireGrid = buildFireGrid(hm, biomes, { cellSize: hm.scale });
const fireSim = new FireSim(fireGrid, { windDirRad: 0, windSpeed: 0 });
const overlay = createFireOverlay(hm);
const fireOverlay = overlay; // naming for clarity above
scene.add(overlay.inst);

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
    if (!stats.getIgniteMode()) return;
    getMouseNDC(e);
    igniteFromNDC(mouse.x, mouse.y);
  });

  // Wire Debug UI: Ignite Center action
  stats.setActions({
    igniteCenter: () => {
      // Screen center is NDC (0,0)
      igniteFromNDC(0, 0);
    }
  });
}
