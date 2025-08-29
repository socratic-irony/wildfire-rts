import { BoxGeometry, Mesh, MeshStandardMaterial } from 'three';
import { createRenderer, resizeRenderer } from './core/renderer';
import { createScene } from './core/scene';
import { createCameraRig, resizeCamera } from './core/camera';
import { Loop } from './core/loop';

const app = document.getElementById('app')!;
const scene = createScene();
const rig = createCameraRig(app);
scene.add(rig.root);

const renderer = createRenderer(app);

// Temporary spinning cube (Stage A acceptance)
const cube = new Mesh(
  new BoxGeometry(2, 2, 2),
  new MeshStandardMaterial({ color: '#4CAF50', flatShading: true })
);
cube.castShadow = true;
cube.receiveShadow = true;
scene.add(cube);

const loop = new Loop();
loop.add((dt) => {
  cube.rotation.y += dt * 0.8;
  cube.rotation.x += dt * 0.3;
  renderer.render(scene, rig.camera);
});
loop.start();

function onResize() {
  resizeRenderer(renderer, app);
  resizeCamera(rig, app);
}

window.addEventListener('resize', onResize);
onResize();

