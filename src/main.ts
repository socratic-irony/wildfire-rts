import { Mesh, Object3D } from 'three';
import { createRenderer, resizeRenderer } from './core/renderer';
import { createScene } from './core/scene';
import { createCameraRig, resizeCamera } from './core/camera';
import { Loop } from './core/loop';
import { generateHeightmap } from './terrain/heightmap';
import { buildTerrainGeometry } from './terrain/mesh';
import { createTerrainMaterial } from './terrain/material';
import { RTSCameraController } from './core/rtsCamera';

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
const terrainGeo = buildTerrainGeometry(hm);
const terrain = new Mesh(terrainGeo, createTerrainMaterial());
terrain.receiveShadow = true;
scene.add(terrain);

// Stage C: RTS camera controller (replaces Orbit)
const terrainObj = terrain as Object3D;
const rts = new RTSCameraController(
  renderer.domElement,
  rig.camera,
  rig.root,
  rig.yaw,
  rig.pitch,
  terrainObj,
  (x, z) => hm.sample(x, z)
);

const loop = new Loop();
loop.add((dt) => {
  const keys = new Set(Array.from([])); // placeholder for future direct key handling
  const move = {
    left: (window as any).keyDown?.('a') || false,
    right: (window as any).keyDown?.('d') || false,
    up: (window as any).keyDown?.('w') || false,
    down: (window as any).keyDown?.('s') || false,
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

  rts.update(dt, move);
  renderer.render(scene, rig.camera);
});
loop.start();

function onResize() {
  resizeRenderer(renderer, app);
  resizeCamera(rig, app);
}

window.addEventListener('resize', onResize);
onResize();
