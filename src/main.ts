import { Mesh } from 'three';
import { createRenderer, resizeRenderer } from './core/renderer';
import { createScene } from './core/scene';
import { createCameraRig, resizeCamera } from './core/camera';
import { Loop } from './core/loop';
import { generateHeightmap } from './terrain/heightmap';
import { buildTerrainGeometry } from './terrain/mesh';
import { createTerrainMaterial } from './terrain/material';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

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

const controls = new OrbitControls(rig.camera, renderer.domElement);
controls.target.set((hm.width * hm.scale) / 2, 0, (hm.height * hm.scale) / 2);
rig.camera.position.set(controls.target.x - 40, 30, controls.target.z + 40);
controls.update();

const loop = new Loop();
loop.add((_dt) => {
  renderer.render(scene, rig.camera);
});
loop.start();

function onResize() {
  resizeRenderer(renderer, app);
  resizeCamera(rig, app);
}

window.addEventListener('resize', onResize);
onResize();
