import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  RingGeometry,
} from 'three';
import { VehicleType } from './types';
import { getDefaults } from './typeDefaults';

function makeYieldIndicator(scale: number): Mesh {
  const geo = new RingGeometry(scale * 0.55, scale * 0.7, 24);
  geo.rotateX(-Math.PI / 2);
  const mat = new MeshBasicMaterial({
    color: new Color(0xf7c948),
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
    side: DoubleSide,
  });
  const ind = new Mesh(geo, mat);
  ind.position.y = -scale * 0.2;
  ind.visible = false;
  ind.renderOrder = 7;
  ind.name = 'yieldIndicator';
  return ind;
}

function makeWheel(scale: number): Mesh {
  const geo = new CylinderGeometry(scale * 0.15, scale * 0.15, scale * 0.12, 12);
  geo.rotateZ(Math.PI / 2);
  const mat = new MeshStandardMaterial({
    color: new Color(0x111111),
    roughness: 0.9,
    metalness: 0.1,
  });
  const m = new Mesh(geo, mat);
  m.castShadow = true;
  return m;
}

function addWheels(group: Group, scale: number, bodyLen: number, bodyWidth: number, yOffset: number) {
  const dx = bodyWidth * 0.55;
  const dz = bodyLen * 0.4;
  const positions: [number, number, number][] = [
    [ dx, yOffset, dz],
    [-dx, yOffset, dz],
    [ dx, yOffset, -dz],
    [-dx, yOffset, -dz],
  ];
  for (const [x, y, z] of positions) {
    const w = makeWheel(scale);
    w.position.set(x, y, z);
    w.name = 'wheel';
    group.add(w);
  }
}

function makeBody(vehicleType: VehicleType, scale: number): { body: Mesh; bodyLen: number; bodyWidth: number; bodyHeight: number } {
  const defaults = getDefaults(vehicleType);
  let bodyWidth: number, bodyHeight: number, bodyLen: number;
  switch (vehicleType) {
    case VehicleType.FIRETRUCK:
      bodyWidth = scale * 0.9; bodyHeight = scale * 0.6; bodyLen = scale * 1.6;
      break;
    case VehicleType.BULLDOZER:
      bodyWidth = scale * 0.7; bodyHeight = scale * 0.35; bodyLen = scale * 0.8;
      break;
    case VehicleType.CAR:
    default:
      bodyWidth = scale * 0.5; bodyHeight = scale * 0.25; bodyLen = scale * 1.0;
      break;
  }
  const mat = new MeshStandardMaterial({
    color: new Color(defaults.color),
    roughness: defaults.roughness,
    metalness: defaults.metalness,
    emissive: new Color(defaults.emissive),
    emissiveIntensity: defaults.emissiveIntensity,
  });
  const body = new Mesh(new BoxGeometry(bodyWidth, bodyHeight, bodyLen), mat);
  body.castShadow = true;
  body.name = 'body';
  return { body, bodyLen, bodyWidth, bodyHeight };
}

function addFiretruckDetails(group: Group, scale: number, bodyLen: number, bodyWidth: number, bodyHeight: number) {
  // Ladder: long thin box along the top
  const ladderMat = new MeshStandardMaterial({
    color: new Color(0xcccccc),
    roughness: 0.6,
    metalness: 0.6,
  });
  const ladder = new Mesh(
    new BoxGeometry(scale * 0.12, scale * 0.08, bodyLen * 0.9),
    ladderMat
  );
  ladder.position.set(0, bodyHeight * 0.5 + scale * 0.05, 0);
  ladder.name = 'ladder';
  ladder.castShadow = true;
  group.add(ladder);
  // Cab (front) accent
  const cab = new Mesh(
    new BoxGeometry(bodyWidth * 0.85, bodyHeight * 0.7, bodyLen * 0.3),
    new MeshStandardMaterial({ color: new Color(0x222222), roughness: 0.5, metalness: 0.3 })
  );
  cab.position.set(0, bodyHeight * 0.45, bodyLen * 0.3);
  cab.name = 'cab';
  group.add(cab);
}

function addBulldozerDetails(group: Group, scale: number, bodyLen: number, bodyWidth: number, bodyHeight: number) {
  // Blade: wide thin box at the front
  const blade = new Mesh(
    new BoxGeometry(bodyWidth * 1.2, bodyHeight * 1.1, scale * 0.12),
    new MeshStandardMaterial({ color: new Color(0x888888), roughness: 0.5, metalness: 0.7 })
  );
  blade.position.set(0, 0, bodyLen * 0.6);
  blade.name = 'blade';
  blade.castShadow = true;
  group.add(blade);
  // Cabin on top
  const cab = new Mesh(
    new BoxGeometry(bodyWidth * 0.6, bodyHeight * 0.8, bodyLen * 0.55),
    new MeshStandardMaterial({ color: new Color(0x554400), roughness: 0.7, metalness: 0.2 })
  );
  cab.position.set(0, bodyHeight * 0.55, -bodyLen * 0.1);
  cab.name = 'cab';
  group.add(cab);
}

function addCarDetails(group: Group, scale: number, bodyLen: number, bodyWidth: number, bodyHeight: number) {
  // Cabin: slightly smaller box on top
  const cab = new Mesh(
    new BoxGeometry(bodyWidth * 0.85, bodyHeight * 0.9, bodyLen * 0.5),
    new MeshStandardMaterial({ color: new Color(0x222233), roughness: 0.3, metalness: 0.2 })
  );
  cab.position.set(0, bodyHeight * 0.6, -bodyLen * 0.05);
  cab.name = 'cab';
  cab.castShadow = true;
  group.add(cab);
}

export function createVehicleMesh(vehicleType: VehicleType, scale: number): Group {
  const group = new Group();
  const { body, bodyLen, bodyWidth, bodyHeight } = makeBody(vehicleType, scale);
  group.add(body);
  addWheels(group, scale, bodyLen, bodyWidth, -bodyHeight * 0.3);
  switch (vehicleType) {
    case VehicleType.FIRETRUCK:
      addFiretruckDetails(group, scale, bodyLen, bodyWidth, bodyHeight);
      break;
    case VehicleType.BULLDOZER:
      addBulldozerDetails(group, scale, bodyLen, bodyWidth, bodyHeight);
      break;
    case VehicleType.CAR:
    default:
      addCarDetails(group, scale, bodyLen, bodyWidth, bodyHeight);
      break;
  }
  const yieldInd = makeYieldIndicator(scale);
  group.add(yieldInd);
  group.userData.yieldIndicator = yieldInd as Object3D;
  return group;
}
