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
    case VehicleType.HELICOPTER:
      bodyWidth = scale * 0.5; bodyHeight = scale * 0.5; bodyLen = scale * 1.2;
      break;
    case VehicleType.AIRPLANE:
      bodyWidth = scale * 0.45; bodyHeight = scale * 0.45; bodyLen = scale * 1.8;
      break;
    case VehicleType.FIREFIGHTER:
      bodyWidth = scale * 0.3; bodyHeight = scale * 0.55; bodyLen = scale * 0.25;
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

function addHelicopterDetails(group: Group, scale: number, bodyLen: number, bodyWidth: number, bodyHeight: number) {
  const metal = new MeshStandardMaterial({ color: new Color(0x333333), roughness: 0.5, metalness: 0.6 });
  // Tail boom
  const boom = new Mesh(new BoxGeometry(bodyWidth * 0.25, bodyHeight * 0.25, bodyLen * 0.9), metal);
  boom.position.set(0, bodyHeight * 0.15, -bodyLen * 0.8);
  boom.name = 'tailBoom';
  group.add(boom);
  // Main rotor: two crossed blades above the cabin
  const bladeA = new Mesh(new BoxGeometry(bodyLen * 1.8, scale * 0.04, scale * 0.12), metal);
  bladeA.position.set(0, bodyHeight * 0.75, 0);
  bladeA.name = 'rotor';
  group.add(bladeA);
  const bladeB = new Mesh(new BoxGeometry(scale * 0.12, scale * 0.04, bodyLen * 1.8), metal);
  bladeB.position.set(0, bodyHeight * 0.75, 0);
  bladeB.name = 'rotor';
  group.add(bladeB);
  // Skids
  for (const side of [-1, 1]) {
    const skid = new Mesh(new BoxGeometry(scale * 0.08, scale * 0.06, bodyLen * 0.9), metal);
    skid.position.set(side * bodyWidth * 0.5, -bodyHeight * 0.55, 0);
    skid.name = 'skid';
    group.add(skid);
  }
}

function addAirplaneDetails(group: Group, scale: number, bodyLen: number, bodyWidth: number, bodyHeight: number) {
  const wingMat = new MeshStandardMaterial({ color: new Color(0xd02020), roughness: 0.5, metalness: 0.4 });
  // Main wings
  const wings = new Mesh(new BoxGeometry(bodyLen * 1.5, scale * 0.07, bodyWidth * 0.9), wingMat);
  wings.position.set(0, bodyHeight * 0.1, bodyLen * 0.1);
  wings.name = 'wings';
  wings.castShadow = true;
  group.add(wings);
  // Tail plane + fin
  const tail = new Mesh(new BoxGeometry(bodyLen * 0.55, scale * 0.06, bodyWidth * 0.5), wingMat);
  tail.position.set(0, bodyHeight * 0.2, -bodyLen * 0.45);
  tail.name = 'tailPlane';
  group.add(tail);
  const fin = new Mesh(new BoxGeometry(scale * 0.06, bodyHeight * 0.9, bodyWidth * 0.6), wingMat);
  fin.position.set(0, bodyHeight * 0.6, -bodyLen * 0.45);
  fin.name = 'tailFin';
  group.add(fin);
}

function addFirefighterDetails(group: Group, scale: number, bodyLen: number, bodyWidth: number, bodyHeight: number) {
  // Head with helmet
  const head = new Mesh(
    new BoxGeometry(bodyWidth * 0.7, bodyWidth * 0.7, bodyWidth * 0.7),
    new MeshStandardMaterial({ color: new Color(0xe0b080), roughness: 0.8, metalness: 0 })
  );
  head.position.set(0, bodyHeight * 0.7, 0);
  head.name = 'head';
  group.add(head);
  const helmet = new Mesh(
    new BoxGeometry(bodyWidth * 0.85, bodyWidth * 0.3, bodyWidth * 0.85),
    new MeshStandardMaterial({ color: new Color(0xffdd00), roughness: 0.5, metalness: 0.1 })
  );
  helmet.position.set(0, bodyHeight * 0.7 + bodyWidth * 0.45, 0);
  helmet.name = 'helmet';
  group.add(helmet);
}

export function createVehicleMesh(vehicleType: VehicleType, scale: number): Group {
  const group = new Group();
  const { body, bodyLen, bodyWidth, bodyHeight } = makeBody(vehicleType, scale);
  group.add(body);
  const wheeled =
    vehicleType === VehicleType.CAR ||
    vehicleType === VehicleType.FIRETRUCK ||
    vehicleType === VehicleType.BULLDOZER;
  if (wheeled) addWheels(group, scale, bodyLen, bodyWidth, -bodyHeight * 0.3);
  switch (vehicleType) {
    case VehicleType.FIRETRUCK:
      addFiretruckDetails(group, scale, bodyLen, bodyWidth, bodyHeight);
      break;
    case VehicleType.BULLDOZER:
      addBulldozerDetails(group, scale, bodyLen, bodyWidth, bodyHeight);
      break;
    case VehicleType.HELICOPTER:
      addHelicopterDetails(group, scale, bodyLen, bodyWidth, bodyHeight);
      break;
    case VehicleType.AIRPLANE:
      addAirplaneDetails(group, scale, bodyLen, bodyWidth, bodyHeight);
      break;
    case VehicleType.FIREFIGHTER:
      addFirefighterDetails(group, scale, bodyLen, bodyWidth, bodyHeight);
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
