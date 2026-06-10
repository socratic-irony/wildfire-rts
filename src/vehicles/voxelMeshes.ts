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

/**
 * Chunky, self-aware voxel vehicle meshes. Everything is boxes (plus wheel
 * cylinders) with flat colors — readable at RTS zoom, more silhouette detail
 * than the original single-box bodies.
 *
 * Named parts the rest of the game relies on:
 *  - 'wheel'        ground-vehicle wheels
 *  - 'ladder'       firetruck test hook
 *  - 'blade'        bulldozer test hook
 *  - 'rotor'        helicopter main rotor blades (spun by the FX loop)
 *  - 'skid'         helicopter skids
 *  - 'wings'/'tailFin' airplane test hooks
 *  - 'helmet'       firefighter test hook
 *  - 'lightbar'     emergency light bar (flash animation hook)
 *  - userData.yieldIndicator   intersection yield ring
 */

export type CivilianStyle = 'sedan' | 'pickup' | 'van' | 'hatchback';

export const CIVILIAN_STYLES: ReadonlyArray<CivilianStyle> = ['sedan', 'pickup', 'van', 'hatchback'];

export const CIVILIAN_COLORS: ReadonlyArray<number> = [
  0x3b82f6, // blue
  0xb91c1c, // dark red
  0xf5f5f4, // white
  0x52525b, // gray
  0x166534, // green
  0xca8a04, // mustard
  0x7c3aed, // purple
  0x0d9488, // teal
];

export type VehicleMeshOptions = {
  civilianStyle?: CivilianStyle;
  color?: number;
};

const DARK_GLASS = 0x1a2230;
const TIRE = 0x141414;
const STEEL = 0xb8bcc2;

function std(color: number, roughness = 0.75, metalness = 0.1): MeshStandardMaterial {
  return new MeshStandardMaterial({ color: new Color(color), roughness, metalness });
}

function box(w: number, h: number, d: number, mat: MeshStandardMaterial, name?: string): Mesh {
  const m = new Mesh(new BoxGeometry(w, h, d), mat);
  m.castShadow = true;
  if (name) m.name = name;
  return m;
}

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

function makeWheel(scale: number, r = 0.15): Mesh {
  const geo = new CylinderGeometry(scale * r, scale * r, scale * 0.12, 10);
  geo.rotateZ(Math.PI / 2);
  const m = new Mesh(geo, std(TIRE, 0.95, 0));
  m.castShadow = true;
  m.name = 'wheel';
  return m;
}

function addWheels(group: Group, scale: number, positions: Array<[number, number, number]>, r = 0.15) {
  for (const [x, y, z] of positions) {
    const w = makeWheel(scale, r);
    w.position.set(x, y, z);
    group.add(w);
  }
}

function addLightbar(group: Group, scale: number, y: number, z: number) {
  const bar = new Group();
  bar.name = 'lightbar';
  const red = new Mesh(
    new BoxGeometry(scale * 0.16, scale * 0.07, scale * 0.1),
    new MeshStandardMaterial({ color: 0xdd1111, emissive: 0xdd1111, emissiveIntensity: 0.8 })
  );
  red.position.set(-scale * 0.1, 0, 0);
  red.name = 'lightRed';
  const blue = new Mesh(
    new BoxGeometry(scale * 0.16, scale * 0.07, scale * 0.1),
    new MeshStandardMaterial({ color: 0x2244ff, emissive: 0x2244ff, emissiveIntensity: 0.8 })
  );
  blue.position.set(scale * 0.1, 0, 0);
  blue.name = 'lightBlue';
  bar.add(red);
  bar.add(blue);
  bar.position.set(0, y, z);
  group.add(bar);
  group.userData.lightbar = bar;
}

// ── Civilian styles ──────────────────────────────────────────────────────────

function buildCivilian(group: Group, scale: number, style: CivilianStyle, color: number) {
  const s = scale;
  const paint = std(color, 0.55, 0.25);
  const glass = std(DARK_GLASS, 0.25, 0.4);

  switch (style) {
    case 'sedan': {
      const body = box(s * 0.52, s * 0.22, s * 1.05, paint, 'body');
      body.position.y = s * 0.18;
      group.add(body);
      const cabin = box(s * 0.46, s * 0.2, s * 0.5, paint, 'cabin');
      cabin.position.set(0, s * 0.38, -s * 0.05);
      group.add(cabin);
      const windows = box(s * 0.47, s * 0.1, s * 0.42, glass, 'windows');
      windows.position.set(0, s * 0.39, -s * 0.05);
      group.add(windows);
      addWheels(group, s, [
        [s * 0.28, s * 0.1, s * 0.32], [-s * 0.28, s * 0.1, s * 0.32],
        [s * 0.28, s * 0.1, -s * 0.32], [-s * 0.28, s * 0.1, -s * 0.32],
      ]);
      break;
    }
    case 'hatchback': {
      const body = box(s * 0.5, s * 0.22, s * 0.85, paint, 'body');
      body.position.y = s * 0.18;
      group.add(body);
      const cabin = box(s * 0.46, s * 0.24, s * 0.55, paint, 'cabin');
      cabin.position.set(0, s * 0.4, -s * 0.1);
      group.add(cabin);
      const windows = box(s * 0.47, s * 0.12, s * 0.48, glass, 'windows');
      windows.position.set(0, s * 0.41, -s * 0.1);
      group.add(windows);
      addWheels(group, s, [
        [s * 0.27, s * 0.1, s * 0.26], [-s * 0.27, s * 0.1, s * 0.26],
        [s * 0.27, s * 0.1, -s * 0.26], [-s * 0.27, s * 0.1, -s * 0.26],
      ]);
      break;
    }
    case 'pickup': {
      const chassis = box(s * 0.54, s * 0.2, s * 1.1, paint, 'body');
      chassis.position.y = s * 0.2;
      group.add(chassis);
      const cab = box(s * 0.5, s * 0.26, s * 0.4, paint, 'cabin');
      cab.position.set(0, s * 0.43, s * 0.18);
      group.add(cab);
      const windows = box(s * 0.51, s * 0.12, s * 0.32, glass, 'windows');
      windows.position.set(0, s * 0.45, s * 0.18);
      group.add(windows);
      const bed = box(s * 0.5, s * 0.12, s * 0.5, std(0x2b2b2b, 0.9, 0.05), 'bed');
      bed.position.set(0, s * 0.34, -s * 0.28);
      group.add(bed);
      addWheels(group, s, [
        [s * 0.3, s * 0.11, s * 0.34], [-s * 0.3, s * 0.11, s * 0.34],
        [s * 0.3, s * 0.11, -s * 0.34], [-s * 0.3, s * 0.11, -s * 0.34],
      ], 0.17);
      break;
    }
    case 'van': {
      const body = box(s * 0.56, s * 0.45, s * 1.1, paint, 'body');
      body.position.y = s * 0.33;
      group.add(body);
      const windshield = box(s * 0.5, s * 0.16, s * 0.06, glass, 'windows');
      windshield.position.set(0, s * 0.45, s * 0.55);
      group.add(windshield);
      addWheels(group, s, [
        [s * 0.3, s * 0.11, s * 0.36], [-s * 0.3, s * 0.11, s * 0.36],
        [s * 0.3, s * 0.11, -s * 0.36], [-s * 0.3, s * 0.11, -s * 0.36],
      ]);
      break;
    }
  }
}

// ── Service vehicles ─────────────────────────────────────────────────────────

function buildFiretruck(group: Group, scale: number) {
  const s = scale;
  const red = std(0xcc1111, 0.5, 0.2);
  const glass = std(DARK_GLASS, 0.25, 0.4);
  const silver = std(STEEL, 0.4, 0.7);

  const chassis = box(s * 0.85, s * 0.3, s * 1.7, red, 'body');
  chassis.position.y = s * 0.28;
  group.add(chassis);
  // Crew cab up front
  const cab = box(s * 0.8, s * 0.45, s * 0.5, red, 'cab');
  cab.position.set(0, s * 0.6, s * 0.55);
  group.add(cab);
  const windshield = box(s * 0.72, s * 0.18, s * 0.06, glass, 'windows');
  windshield.position.set(0, s * 0.68, s * 0.81);
  group.add(windshield);
  // Equipment body with white stripe
  const bodyBack = box(s * 0.8, s * 0.5, s * 1.0, red, 'equipment');
  bodyBack.position.set(0, s * 0.62, -s * 0.3);
  group.add(bodyBack);
  const stripe = box(s * 0.82, s * 0.1, s * 1.0, std(0xf5f5f4, 0.6, 0.1), 'stripe');
  stripe.position.set(0, s * 0.52, -s * 0.3);
  group.add(stripe);
  // Ladder: two rails + rungs
  const ladder = new Group();
  ladder.name = 'ladder';
  for (const side of [-1, 1]) {
    const rail = box(s * 0.05, s * 0.05, s * 1.1, silver);
    rail.position.set(side * s * 0.14, 0, 0);
    ladder.add(rail);
  }
  for (let i = -2; i <= 2; i++) {
    const rung = box(s * 0.3, s * 0.04, s * 0.05, silver);
    rung.position.set(0, 0, i * s * 0.24);
    ladder.add(rung);
  }
  ladder.position.set(0, s * 0.93, -s * 0.25);
  group.add(ladder);
  addLightbar(group, s, s * 0.88, s * 0.55);
  // Bumper
  const bumper = box(s * 0.8, s * 0.12, s * 0.08, silver, 'bumper');
  bumper.position.set(0, s * 0.25, s * 0.86);
  group.add(bumper);
  addWheels(group, s, [
    [s * 0.45, s * 0.16, s * 0.55], [-s * 0.45, s * 0.16, s * 0.55],
    [s * 0.45, s * 0.16, -s * 0.1], [-s * 0.45, s * 0.16, -s * 0.1],
    [s * 0.45, s * 0.16, -s * 0.6], [-s * 0.45, s * 0.16, -s * 0.6],
  ], 0.18);
}

function buildBulldozer(group: Group, scale: number) {
  const s = scale;
  const yellow = std(0xf2b50a, 0.7, 0.2);
  const dark = std(0x2b2b2b, 0.9, 0.1);
  const glass = std(DARK_GLASS, 0.3, 0.3);

  const body = box(s * 0.62, s * 0.32, s * 0.85, yellow, 'body');
  body.position.y = s * 0.36;
  group.add(body);
  // Tracks
  for (const side of [-1, 1]) {
    const track = box(s * 0.22, s * 0.3, s * 1.0, dark, 'track');
    track.position.set(side * s * 0.42, s * 0.18, 0);
    group.add(track);
  }
  // Cab with window band
  const cab = box(s * 0.45, s * 0.4, s * 0.45, yellow, 'cab');
  cab.position.set(0, s * 0.72, -s * 0.1);
  group.add(cab);
  const windows = box(s * 0.47, s * 0.2, s * 0.4, glass, 'windows');
  windows.position.set(0, s * 0.78, -s * 0.1);
  group.add(windows);
  // Blade with lift arms
  const blade = box(s * 0.95, s * 0.4, s * 0.1, std(0x8a8f96, 0.5, 0.7), 'blade');
  blade.position.set(0, s * 0.3, s * 0.62);
  group.add(blade);
  for (const side of [-1, 1]) {
    const arm = box(s * 0.07, s * 0.07, s * 0.5, dark, 'arm');
    arm.position.set(side * s * 0.36, s * 0.34, s * 0.36);
    group.add(arm);
  }
  // Exhaust stack
  const stack = box(s * 0.08, s * 0.3, s * 0.08, dark, 'exhaust');
  stack.position.set(s * 0.15, s * 0.66, s * 0.25);
  group.add(stack);
}

function buildHelicopter(group: Group, scale: number) {
  const s = scale;
  const paint = std(0xd03a1e, 0.5, 0.3);
  const dark = std(0x23272e, 0.6, 0.4);
  const glass = std(DARK_GLASS, 0.2, 0.5);

  const body = box(s * 0.5, s * 0.45, s * 0.95, paint, 'body');
  body.position.y = s * 0.55;
  group.add(body);
  const nose = box(s * 0.4, s * 0.3, s * 0.25, glass, 'nose');
  nose.position.set(0, s * 0.55, s * 0.56);
  group.add(nose);
  // Belly tank (water payload)
  const tank = box(s * 0.34, s * 0.16, s * 0.6, std(0x3f5a78, 0.5, 0.4), 'tank');
  tank.position.set(0, s * 0.3, 0);
  group.add(tank);
  // Tail boom + fin + tail rotor
  const boom = box(s * 0.14, s * 0.14, s * 0.85, paint, 'tailBoom');
  boom.position.set(0, s * 0.62, -s * 0.85);
  group.add(boom);
  const fin = box(s * 0.06, s * 0.3, s * 0.18, paint, 'tailFinH');
  fin.position.set(0, s * 0.78, -s * 1.22);
  group.add(fin);
  const tailRotor = box(s * 0.04, s * 0.4, s * 0.08, dark, 'tailRotor');
  tailRotor.position.set(s * 0.06, s * 0.78, -s * 1.22);
  group.add(tailRotor);
  // Main rotor: hub + crossed blades, grouped for spinning
  const rotor = new Group();
  rotor.name = 'mainRotor';
  const hub = box(s * 0.1, s * 0.08, s * 0.1, dark);
  rotor.add(hub);
  const bladeA = box(s * 2.0, s * 0.03, s * 0.1, dark, 'rotor');
  rotor.add(bladeA);
  const bladeB = box(s * 0.1, s * 0.03, s * 2.0, dark, 'rotor');
  rotor.add(bladeB);
  rotor.position.set(0, s * 0.85, 0);
  group.add(rotor);
  group.userData.mainRotor = rotor;
  // Skids
  for (const side of [-1, 1]) {
    const skid = box(s * 0.06, s * 0.05, s * 1.0, dark, 'skid');
    skid.position.set(side * s * 0.3, s * 0.08, 0);
    group.add(skid);
    for (const fz of [-0.3, 0.3]) {
      const strut = box(s * 0.05, s * 0.22, s * 0.05, dark, 'strut');
      strut.position.set(side * s * 0.28, s * 0.2, s * fz);
      group.add(strut);
    }
  }
}

function buildAirplane(group: Group, scale: number) {
  const s = scale;
  const white = std(0xf0f0ec, 0.45, 0.4);
  const red = std(0xd02020, 0.5, 0.4);
  const dark = std(0x23272e, 0.6, 0.4);

  const fuselage = box(s * 0.42, s * 0.42, s * 1.7, white, 'body');
  fuselage.position.y = s * 0.5;
  group.add(fuselage);
  const nose = box(s * 0.34, s * 0.32, s * 0.3, dark, 'nose');
  nose.position.set(0, s * 0.48, s * 0.95);
  group.add(nose);
  // Retardant belly
  const belly = box(s * 0.36, s * 0.16, s * 1.0, red, 'retardantTank');
  belly.position.set(0, s * 0.26, 0);
  group.add(belly);
  // High wing + engine nacelles
  const wings = box(s * 2.4, s * 0.07, s * 0.42, white, 'wings');
  wings.position.set(0, s * 0.74, s * 0.15);
  group.add(wings);
  for (const side of [-1, 1]) {
    const nacelle = box(s * 0.16, s * 0.16, s * 0.4, red, 'engine');
    nacelle.position.set(side * s * 0.7, s * 0.66, s * 0.25);
    group.add(nacelle);
    const prop = box(s * 0.04, s * 0.4, s * 0.04, dark, 'prop');
    prop.position.set(side * s * 0.7, s * 0.66, s * 0.47);
    group.add(prop);
  }
  // Tail
  const tailPlane = box(s * 0.9, s * 0.06, s * 0.3, white, 'tailPlane');
  tailPlane.position.set(0, s * 0.62, -s * 0.78);
  group.add(tailPlane);
  const fin = box(s * 0.06, s * 0.5, s * 0.35, red, 'tailFin');
  fin.position.set(0, s * 0.85, -s * 0.78);
  group.add(fin);
}

function buildFirefighter(group: Group, scale: number) {
  const s = scale;
  const jacket = std(0xd9a514, 0.85, 0);
  const pants = std(0x3f4754, 0.9, 0);
  const skin = std(0xe0b080, 0.8, 0);

  for (const side of [-1, 1]) {
    const leg = box(s * 0.09, s * 0.22, s * 0.1, pants, 'leg');
    leg.position.set(side * s * 0.06, s * 0.11, 0);
    group.add(leg);
  }
  const torso = box(s * 0.26, s * 0.26, s * 0.16, jacket, 'body');
  torso.position.y = s * 0.35;
  group.add(torso);
  for (const side of [-1, 1]) {
    const arm = box(s * 0.07, s * 0.24, s * 0.09, jacket, 'arm');
    arm.position.set(side * s * 0.17, s * 0.36, 0);
    group.add(arm);
  }
  const tank = box(s * 0.14, s * 0.2, s * 0.08, std(0x9a3a3a, 0.6, 0.3), 'airTank');
  tank.position.set(0, s * 0.36, -s * 0.13);
  group.add(tank);
  const head = box(s * 0.14, s * 0.13, s * 0.13, skin, 'head');
  head.position.y = s * 0.56;
  group.add(head);
  const helmet = box(s * 0.2, s * 0.07, s * 0.2, std(0xffdd00, 0.5, 0.1), 'helmet');
  helmet.position.y = s * 0.65;
  group.add(helmet);
}

// ── Entry point ──────────────────────────────────────────────────────────────

export function createVehicleMesh(
  vehicleType: VehicleType,
  scale: number,
  opts: VehicleMeshOptions = {},
): Group {
  const group = new Group();
  switch (vehicleType) {
    case VehicleType.FIRETRUCK:
      buildFiretruck(group, scale);
      break;
    case VehicleType.BULLDOZER:
      buildBulldozer(group, scale);
      break;
    case VehicleType.HELICOPTER:
      buildHelicopter(group, scale);
      break;
    case VehicleType.AIRPLANE:
      buildAirplane(group, scale);
      break;
    case VehicleType.FIREFIGHTER:
      buildFirefighter(group, scale);
      break;
    case VehicleType.CAR:
    default:
      buildCivilian(group, scale, opts.civilianStyle ?? 'sedan', opts.color ?? CIVILIAN_COLORS[0]);
      break;
  }
  const yieldInd = makeYieldIndicator(scale);
  group.add(yieldInd);
  group.userData.yieldIndicator = yieldInd as Object3D;
  return group;
}
