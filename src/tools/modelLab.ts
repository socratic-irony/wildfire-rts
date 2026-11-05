import {
  CircleGeometry,
  Group,
  InstancedMesh,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  OrthographicCamera,
  PlaneGeometry,
  Vector3,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createRenderer, createScene } from '../core/scene';
import { ModelBuilder } from '../core/modelBuilder';
import { buildModel, MODEL_BODY, setWindowGlow } from '../core/modelMaterials';
import { createVehicleModel, UnitKind, VehicleModel } from '../sim/vehicleModels';
import { BUILDING_KINDS, BUILDING_LABELS, BuildingKind, LOT_FRONTAGE } from '../world/buildingModels';
import { createBuildingPreview } from '../world/buildings';
import { createHydrantGeometry } from '../world/hydrants';
import { speciesGeometry } from '../world/vegetation';
import { TILE_SIZE } from '../world/constants';

/**
 * Model lab: every vehicle and building type on a stretch of road, under the
 * game's lights and camera, for checking proportions and detail. Query
 * parameters pick the view (`view=vehicles|buildings|ruins|all`), the
 * building seed (`seed`), and the camera (`yaw`, `pitch`, `size`, `x`, `z`).
 * `scripts/models.mjs` screenshots it.
 */
const params = new URLSearchParams(window.location.search);
const view = params.get('view') ?? 'all';
const seed = Number(params.get('seed') ?? 7);

const container = document.getElementById('lab') as HTMLElement;
const renderer = createRenderer(container);
const scene = createScene();
scene.fog = null;
const sun = scene.getObjectByName('sun');
if (sun) {
  sun.position.set(40, 80, 30);
  const light = sun as unknown as { target: Object3D; shadow: { camera: OrthographicCamera } };
  light.target.position.set(0, 0, 0);
  light.shadow.camera.left = -40;
  light.shadow.camera.right = 40;
  light.shadow.camera.top = 40;
  light.shadow.camera.bottom = -40;
  light.shadow.camera.updateProjectionMatrix();
}
setWindowGlow(Number(params.get('dusk') ?? 0));

const labels: Array<{ text: string; position: Vector3; element: HTMLElement }> = [];
function label(text: string, x: number, y: number, z: number): void {
  const element = document.createElement('div');
  element.className = 'lab-label';
  element.textContent = text;
  document.body.appendChild(element);
  labels.push({ text, position: new Vector3(x, y, z), element });
}

// Ground and a two-lane road along x.
const ground = new Mesh(new PlaneGeometry(160, 120), new MeshStandardMaterial({ color: 0x8aa35f, roughness: 0.95 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
const road = new ModelBuilder();
road.box(80, 0.02, TILE_SIZE, 0x4c4d4a, 0, 0.01, 0);
for (let x = -39; x < 40; x += 1.2) road.box(0.6, 0.022, 0.06, 0xe8c45a, x, 0.012, 0);
for (const z of [-0.92, 0.92]) road.box(80, 0.022, 0.05, 0xe9e5d8, 0, 0.012, z);
for (const z of [-1.2, 1.2]) road.box(80, 0.015, 0.4, 0xb3a07a, 0, 0.006, z);
// A side street and a dirt pad for the dozer.
road.box(TILE_SIZE, 0.02, 30, 0x4c4d4a, 18, 0.01, -15);
road.box(5, 0.012, 4, 0x9c8462, -15, 0.006, -3.5);
const roadModel = buildModel(road);
scene.add(roadModel);

// People for scale (1.8 m tall = 0.6 units).
const people = new ModelBuilder();
for (const [x, z, color] of [
  [-11.2, 1.5, 0x2f4e6e],
  [-10.9, 1.6, 0xc0392b],
  [3.5, 1.5, 0x3e5a3a],
] as const) {
  people.cylinder(0.08, 0.36, 0x3a3a3a, x, 0.18, z, undefined, 6);
  people.cylinder(0.1, 0.24, color, x, 0.46, z, undefined, 6);
  people.sphere(0.07, 0.08, 0.07, 0xd8b090, x, 0.66, z, 6);
}
scene.add(buildModel(people));

// Hydrants on the shoulder.
const hydrantGeometry = createHydrantGeometry();
const hydrants = new InstancedMesh(hydrantGeometry, MODEL_BODY, 3);
[-9, 2, 12].forEach((x, i) => {
  const dummy = new Object3D();
  dummy.position.set(x, 0, 1.18);
  dummy.updateMatrix();
  hydrants.setMatrixAt(i, dummy.matrix);
});
hydrants.castShadow = true;
scene.add(hydrants);
label('hydrant', 2, 0.6, 1.4);

// Trees for scale.
const treeMaterial = new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 });
for (const [species, x, z] of [
  ['pine', -20, -4],
  ['oak', 24, 4],
  ['fir', -22, 5],
  ['aspen', 26, -5],
] as const) {
  const tree = new Mesh(speciesGeometry(species), treeMaterial);
  tree.position.set(x, 0, z);
  tree.castShadow = true;
  scene.add(tree);
  label(species, x, 0.1, z + 1.2);
}

// Vehicles.
const vehicles: Array<{ kind: UnitKind; model: VehicleModel }> = [];
function placeVehicle(kind: UnitKind, x: number, z: number, heading: number, y = 0): void {
  const model = createVehicleModel(kind);
  model.group.position.set(x, y, z);
  model.group.rotation.y = heading;
  scene.add(model.group);
  vehicles.push({ kind, model });
}
const showVehicles = view === 'vehicles' || view === 'all';
const showBuildings = view === 'buildings' || view === 'ruins' || view === 'all';
if (showVehicles) {
  placeVehicle('firetruck', -10, -0.48, -Math.PI / 2);
  placeVehicle('firetruck', -5.5, 0.48, Math.PI / 2);
  placeVehicle('dozer', -15, -3.5, Math.PI * 0.75);
  const pad = new Mesh(new CircleGeometry(3, 32), new MeshStandardMaterial({ color: 0x5b5e5a, roughness: 0.95 }));
  pad.rotation.x = -Math.PI / 2;
  pad.position.set(4, 0.03, -5);
  pad.receiveShadow = true;
  scene.add(pad);
  placeVehicle('helicopter', 4, -5, Math.PI * 0.15, 0.08);
  placeVehicle('tanker', 12, -6.5, Math.PI * 0.6, 0.3);
  placeVehicle('helicopter', 6, 6, -Math.PI * 0.35, 3.5);
  placeVehicle('tanker', -2, 9, Math.PI * 0.42, 5);
  label('engine', -10, 0.05, -1.6);
  label('dozer', -15, 0.05, -1.6);
  label('helicopter', 4, 0.05, -1.6);
  label('air tanker', 12, 0.05, -3);
}

// Buildings: one lot per kind, alternating sides of the road.
const buildings = new Group();
if (showBuildings) {
  const kinds = BUILDING_KINDS;
  let northX = -30;
  let southX = -30;
  kinds.forEach((kind: BuildingKind, i) => {
    const width = LOT_FRONTAGE[kind] * TILE_SIZE;
    const north = i % 2 === 0;
    const x = (north ? northX : southX) + width / 2;
    if (north) northX += width + 1.2;
    else southX += width + 1.2;
    const z = north ? -(1 + 0.4 + 2) : 1 + 0.4 + 2;
    const model = createBuildingPreview(kind, seed + i * 31, view === 'ruins');
    model.position.set(x, 0, z);
    model.rotation.y = north ? 0 : Math.PI;
    buildings.add(model);
    label(BUILDING_LABELS[kind], x, 0.05, north ? z - 2.4 : z + 2.4);
  });
  scene.add(buildings);
}

// Camera: the game's orthographic diorama view by default.
const aspect = window.innerWidth / window.innerHeight;
const size = Number(params.get('size') ?? (view === 'vehicles' ? 20 : view === 'all' ? 46 : 30));
const camera = new OrthographicCamera((-size * aspect) / 2, (size * aspect) / 2, size / 2, -size / 2, 0.1, 900);
const yaw = Number(params.get('yaw') ?? 0.5);
const pitch = Number(params.get('pitch') ?? 0.75);
const target = new Vector3(
  Number(params.get('x') ?? (view === 'vehicles' ? -2 : 0)),
  0,
  Number(params.get('z') ?? (view === 'vehicles' ? -1 : 0)),
);
const distance = 200;
camera.position.set(
  target.x + Math.sin(yaw) * Math.cos(pitch) * distance,
  target.y + Math.sin(pitch) * distance,
  target.z + Math.cos(yaw) * Math.cos(pitch) * distance,
);
camera.lookAt(target);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.copy(target);
controls.update();

// View switcher.
const bar = document.createElement('div');
bar.className = 'lab-bar';
for (const option of ['all', 'vehicles', 'buildings', 'ruins']) {
  const link = document.createElement('a');
  const next = new URLSearchParams(params);
  next.set('view', option);
  link.href = `?${next.toString()}`;
  link.textContent = option;
  if (option === view) link.className = 'on';
  bar.appendChild(link);
}
const reseed = document.createElement('a');
const reseedParams = new URLSearchParams(params);
reseedParams.set('seed', String(seed + 1));
reseed.href = `?${reseedParams.toString()}`;
reseed.textContent = `seed ${seed} →`;
bar.appendChild(reseed);
document.body.appendChild(bar);
if (params.get('labels') === '0') bar.style.display = 'none';

window.addEventListener('resize', () => {
  const a = window.innerWidth / window.innerHeight;
  const s = (camera.top - camera.bottom) / camera.zoom;
  camera.left = (-s * a) / 2;
  camera.right = (s * a) / 2;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

let time = 0;
let last = performance.now();
const projected = new Vector3();
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  time += dt;
  for (const { model } of vehicles) {
    if (model.rotor) model.rotor.rotation.y += dt * 22;
    if (model.tailRotor) model.tailRotor.rotation.x += dt * 30;
    for (const prop of model.props) prop.rotation.z += dt * 38;
    for (const disc of model.blurDiscs) disc.visible = params.get('blur') === '1';
    if (model.redLight) model.redLight.emissiveIntensity = 1.4 + Math.sin(time * 14) * 1.1;
    if (model.blueLight) model.blueLight.emissiveIntensity = 1.4 + Math.cos(time * 14) * 1.1;
  }
  controls.update();
  renderer.render(scene, camera);
  if (params.get('labels') !== '0') {
    for (const item of labels) {
      projected.copy(item.position).project(camera);
      item.element.style.left = `${((projected.x + 1) / 2) * window.innerWidth}px`;
      item.element.style.top = `${((1 - projected.y) / 2) * window.innerHeight}px`;
    }
  } else {
    for (const item of labels) item.element.style.display = 'none';
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
(window as unknown as { __modelLabReady: boolean }).__modelLabReady = true;
