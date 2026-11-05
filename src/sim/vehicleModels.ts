import {
  BoxGeometry,
  CircleGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
} from 'three';
import { darken, ModelBuilder } from '../core/modelBuilder';
import { buildModel, buildPart, MODEL_BODY } from '../core/modelMaterials';

export type UnitKind = 'firetruck' | 'dozer' | 'helicopter' | 'tanker';

/**
 * Vehicles are modelled at the world's prop scale: 1 world unit ≈ 3 m, so a
 * road tile (2 units) is a 6 m two-lane road and an engine (8.5 m × 2.5 m)
 * fills most of one lane.
 */
export const METERS_PER_UNIT = 3;

export interface VehicleModel {
  group: Group;
  rotor: Object3D | null;
  tailRotor: Object3D | null;
  /** Propellers (air tanker), spun about their local z axis. */
  props: Object3D[];
  /** Translucent discs shown while rotors/props are at speed. */
  blurDiscs: Mesh[];
  redLight: MeshStandardMaterial | null;
  blueLight: MeshStandardMaterial | null;
  /** Ground footprint used to tilt the model to the terrain (world units). */
  length: number;
  width: number;
}

const RED = 0xb3271f;
const RED_DARK = 0x86201a;
const WHITE = 0xece7da;
const CHROME = 0xc4cbcb;
const STEEL = 0x7b8382;
const DARK = 0x2b2f2c;
const TIRE = 0x1b1d1b;
const HUB = 0x9ca19e;
const GLASS = 0x2b4552;
const AMBER = 0xffae2a;
const YELLOW = 0xd9a21b;
const HOSE = 0xd8b45a;

function lamp(color: number, emissive: number): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color,
    emissive,
    emissiveIntensity: 1.3,
    roughness: 0.32,
    metalness: 0.05,
    flatShading: true,
  });
}

/** Invisible box that makes small vehicles easy to click. */
const PICK_MATERIAL = new MeshBasicMaterial({ visible: false });

function pickBox(width: number, height: number, length: number, y: number): Mesh {
  const mesh = new Mesh(new BoxGeometry(width, height, length), PICK_MATERIAL);
  mesh.position.y = y;
  mesh.name = 'pick';
  return mesh;
}

const BLUR_MATERIAL = new MeshBasicMaterial({
  color: 0x1c1f1d,
  transparent: true,
  opacity: 0.14,
  depthWrite: false,
  side: DoubleSide,
});

function blurDisc(radius: number): Mesh {
  const disc = new Mesh(new CircleGeometry(radius, 28), BLUR_MATERIAL);
  disc.name = 'rotor-blur';
  return disc;
}

export function createVehicleModel(kind: UnitKind): VehicleModel {
  switch (kind) {
    case 'firetruck':
      return createEngine();
    case 'dozer':
      return createDozer();
    case 'helicopter':
      return createHelicopter();
    default:
      return createAirTanker();
  }
}

/** Type 3 wildland engine: conventional 4×4 crew cab, compartment body, hose reel. */
function createEngine(): VehicleModel {
  const b = new ModelBuilder();
  // Running gear.
  b.box(0.5, 0.1, 2.5, DARK, 0, 0.27, -0.02);
  for (const side of [-1, 1]) {
    b.wheel(0.17, 0.12, TIRE, HUB, side * 0.345, 0.17, 0.86, 12);
    b.wheel(0.17, 0.11, TIRE, HUB, side * 0.36, 0.17, -0.72, 12);
    b.wheel(0.17, 0.1, TIRE, darken(HUB, 0.8), side * 0.25, 0.17, -0.72, 12);
    // Fender flares.
    b.box(0.13, 0.04, 0.44, DARK, side * 0.36, 0.36, 0.86);
    b.box(0.08, 0.05, 0.46, DARK, side * 0.395, 0.355, -0.72);
    // Steps under the doors.
    b.box(0.08, 0.03, 0.62, STEEL, side * 0.42, 0.3, 0.27);
  }
  // Bumper with a turret nozzle and tow hooks.
  b.box(0.82, 0.09, 0.08, CHROME, 0, 0.26, 1.39);
  b.cylinder(0.035, 0.08, STEEL, 0.18, 0.34, 1.37, undefined, 6);
  b.box(0.03, 0.03, 0.14, STEEL, 0.18, 0.39, 1.43, { x: -0.3 });
  for (const side of [-1, 1]) b.box(0.05, 0.04, 0.05, RED_DARK, side * 0.3, 0.22, 1.44);
  // Hood and grille.
  b.loft(
    [
      { z: 0.64, w: 0.76, h: 0.34, y: 0.5, bevel: 0.25 },
      { z: 1.28, w: 0.72, h: 0.3, y: 0.48, bevel: 0.3 },
      { z: 1.36, w: 0.66, h: 0.26, y: 0.47, bevel: 0.3 },
    ],
    RED,
  );
  b.box(0.46, 0.17, 0.02, DARK, 0, 0.45, 1.365);
  for (let i = 0; i < 4; i += 1) b.box(0.44, 0.012, 0.025, CHROME, 0, 0.39 + i * 0.04, 1.372);
  b.use('glow');
  for (const side of [-1, 1]) {
    b.box(0.09, 0.06, 0.02, 0xfff2cc, side * 0.27, 0.48, 1.37);
    b.box(0.05, 0.03, 0.02, AMBER, side * 0.36, 0.42, 1.37);
  }
  b.use('body');
  // Crew cab: red lower, white roof cap.
  b.block(0.8, 0.5, 0.82, RED, 0, 0.33, 0.25);
  b.block(0.78, 0.14, 0.72, WHITE, 0, 0.83, 0.22);
  b.box(0.81, 0.02, 0.83, darken(RED, 0.7), 0, 0.6, 0.25);
  // Door seams and handles.
  for (const side of [-1, 1]) {
    b.box(0.012, 0.42, 0.01, darken(RED, 0.65), side * 0.401, 0.56, 0.25);
    for (const z of [0.5, 0.08]) b.box(0.012, 0.015, 0.06, CHROME, side * 0.402, 0.6, z);
    // Mirrors on arms.
    b.box(0.08, 0.015, 0.015, DARK, side * 0.44, 0.78, 0.6);
    b.box(0.02, 0.1, 0.06, DARK, side * 0.48, 0.76, 0.6);
  }
  b.use('glass');
  // Raked windscreen and side glass.
  b.quad([-0.37, 0.84, 0.66], [0.37, 0.84, 0.66], [0.35, 0.96, 0.58], [-0.35, 0.96, 0.58], GLASS);
  for (const side of [-1, 1]) {
    for (const z of [0.44, 0.06]) b.box(0.012, 0.18, 0.3, GLASS, side * 0.402, 0.76, z);
  }
  b.use('body');
  b.quad([-0.37, 0.83, 0.661], [-0.35, 0.96, 0.581], [-0.39, 0.96, 0.581], [-0.4, 0.83, 0.661], RED);
  b.quad([0.4, 0.83, 0.661], [0.39, 0.96, 0.581], [0.35, 0.96, 0.581], [0.37, 0.83, 0.661], RED);
  // Light bar mount (lamps are separate, they flash).
  b.box(0.66, 0.03, 0.12, DARK, 0, 0.985, 0.42);
  // Pump panel between cab and body.
  b.block(0.82, 0.58, 0.12, CHROME, 0, 0.33, -0.22);
  for (const side of [-1, 1]) {
    b.cylinder(0.025, 0.02, DARK, side * 0.415, 0.72, -0.2, { z: Math.PI / 2 }, 8);
    b.cylinder(0.025, 0.02, DARK, side * 0.415, 0.62, -0.25, { z: Math.PI / 2 }, 8);
    b.box(0.03, 0.04, 0.04, RED, side * 0.42, 0.48, -0.22);
  }
  // Compartment body with roll-up doors.
  b.block(0.82, 0.62, 1.12, RED, 0, 0.33, -0.86);
  for (const side of [-1, 1]) {
    for (const z of [-0.47, -0.83, -1.19]) {
      b.box(0.012, 0.44, 0.31, CHROME, side * 0.414, 0.64, z);
      for (let r = 0; r < 5; r += 1) b.box(0.014, 0.008, 0.29, darken(CHROME, 0.75), side * 0.416, 0.48 + r * 0.075, z);
      b.box(0.016, 0.02, 0.06, DARK, side * 0.418, 0.44, z);
    }
    // Reflective stripe along cab and body.
    b.box(0.014, 0.035, 2.0, WHITE, side * 0.409, 0.4, -0.3);
  }
  // Top: hose bed, ladder, reel.
  b.box(0.74, 0.04, 1.0, DARK, 0, 0.97, -0.82);
  for (let i = 0; i < 4; i += 1) b.box(0.66, 0.035, 0.2, HOSE, 0, 1.0, -0.42 - i * 0.24);
  for (const x of [0.33, 0.24]) b.box(0.02, 0.02, 1.1, STEEL, x, 1.05, -0.84);
  for (let i = 0; i < 9; i += 1) b.box(0.1, 0.012, 0.012, STEEL, 0.285, 1.05, -0.34 - i * 0.12);
  b.cylinder(0.11, 0.5, HOSE, 0, 0.84, -1.34, { z: Math.PI / 2 }, 10);
  for (const side of [-1, 1]) b.cylinder(0.13, 0.02, RED_DARK, side * 0.26, 0.84, -1.34, { z: Math.PI / 2 }, 10);
  // Rear bumper, chevrons and tail lights.
  b.box(0.82, 0.08, 0.06, DARK, 0, 0.3, -1.43);
  for (let i = 0; i < 4; i += 1) b.box(0.08, 0.06, 0.012, i % 2 === 0 ? WHITE : RED, -0.3 + i * 0.2, 0.48, -1.425, { z: 0.7 });
  b.use('glow');
  for (const side of [-1, 1]) {
    b.box(0.06, 0.08, 0.01, 0xff3a2a, side * 0.36, 0.5, -1.425);
    b.box(0.06, 0.03, 0.01, AMBER, side * 0.36, 0.43, -1.425);
  }
  b.use('body');

  const group = new Group();
  group.name = 'vehicle-firetruck';
  group.add(buildModel(b));
  const redLight = lamp(0xf0442e, 0xd51f15);
  const blueLight = lamp(0x3877ff, 0x1d4fd3);
  for (const [material, x] of [
    [redLight, -0.17],
    [blueLight, 0.17],
  ] as const) {
    const light = new Mesh(new BoxGeometry(0.28, 0.05, 0.1), material);
    light.position.set(x, 1.02, 0.42);
    group.add(light);
  }
  // Rear beacon pair on the body.
  for (const [material, x] of [
    [redLight, -0.3],
    [blueLight, 0.3],
  ] as const) {
    const light = new Mesh(new BoxGeometry(0.06, 0.05, 0.06), material);
    light.position.set(x, 0.98, -1.36);
    group.add(light);
  }
  group.add(pickBox(1.2, 1.4, 3.2, 0.6));
  return { group, rotor: null, tailRotor: null, props: [], blurDiscs: [], redLight, blueLight, length: 2.6, width: 0.8 };
}

/** Medium crawler dozer with a ROPS cab, angled blade and rear ripper. */
function createDozer(): VehicleModel {
  const b = new ModelBuilder();
  const yellow = YELLOW;
  const trackColor = 0x2a2a27;
  for (const side of [-1, 1]) {
    const x = side * 0.36;
    b.push(x, 0, 0);
    b.loft(
      [
        { z: -0.7, w: 0.24, h: 0.16, y: 0.16, bevel: 0.2 },
        { z: -0.62, w: 0.24, h: 0.3, y: 0.17, bevel: 0.15 },
        { z: 0.6, w: 0.24, h: 0.3, y: 0.17, bevel: 0.15 },
        { z: 0.68, w: 0.24, h: 0.16, y: 0.16, bevel: 0.2 },
      ],
      trackColor,
    );
    // Grousers on the top run, rollers on the side.
    for (let i = 0; i < 13; i += 1) b.box(0.25, 0.02, 0.03, darken(trackColor, 0.6), 0, 0.33, -0.58 + i * 0.097);
    for (let i = 0; i < 5; i += 1) b.cylinder(0.05, 0.02, STEEL, side * 0.125, 0.11, -0.44 + i * 0.22, { z: Math.PI / 2 }, 8);
    // Track frame and raised sprocket.
    b.box(0.06, 0.1, 1.0, yellow, side * -0.14, 0.22, 0);
    b.cylinder(0.12, 0.2, darken(trackColor, 1.2), 0, 0.36, -0.52, { z: Math.PI / 2 }, 9);
    b.pop();
  }
  // Rear deck and fuel tank, engine hood with grille and stack.
  b.block(0.64, 0.24, 0.62, yellow, 0, 0.3, -0.36);
  b.block(0.56, 0.3, 0.66, yellow, 0, 0.3, 0.3);
  b.loft(
    [
      { z: -0.02, w: 0.56, h: 0.08, y: 0.64, bevel: 0.4 },
      { z: 0.6, w: 0.5, h: 0.05, y: 0.62, bevel: 0.4 },
    ],
    darken(yellow, 0.92),
  );
  b.box(0.42, 0.22, 0.02, DARK, 0, 0.44, 0.635);
  for (let i = 0; i < 5; i += 1) b.box(0.4, 0.012, 0.025, darken(yellow, 0.6), 0, 0.36 + i * 0.04, 0.642);
  b.cylinder(0.032, 0.28, DARK, 0.15, 0.74, 0.42, undefined, 8);
  b.cylinder(0.05, 0.12, darken(yellow, 0.8), -0.15, 0.7, 0.44, undefined, 8);
  // ROPS cab.
  for (const [x, z] of [
    [-0.3, -0.5],
    [0.3, -0.5],
    [-0.3, -0.04],
    [0.3, -0.04],
  ] as const) {
    b.box(0.05, 0.5, 0.05, darken(yellow, 0.85), x, 0.79, z);
  }
  b.box(0.68, 0.06, 0.6, yellow, 0, 1.06, -0.27);
  b.box(0.7, 0.02, 0.62, darken(yellow, 0.7), 0, 1.03, -0.27);
  b.use('glass');
  b.block(0.54, 0.42, 0.42, GLASS, 0, 0.54, -0.27);
  b.use('body');
  b.box(0.18, 0.12, 0.16, DARK, 0, 0.66, -0.3);
  // Blade on push arms, with lift cylinders.
  b.box(1.2, 0.06, 0.07, STEEL, 0, 0.04, 0.95);
  b.box(1.2, 0.2, 0.05, yellow, 0, 0.17, 0.93, { x: -0.18 });
  b.box(1.2, 0.17, 0.05, yellow, 0, 0.34, 0.89, { x: -0.55 });
  b.box(1.2, 0.04, 0.08, darken(yellow, 0.8), 0, 0.43, 0.85);
  for (const side of [-1, 1]) {
    b.box(0.05, 0.4, 0.2, darken(yellow, 0.9), side * 0.6, 0.22, 0.9);
    b.box(0.07, 0.08, 0.5, darken(yellow, 0.9), side * 0.36, 0.2, 0.62);
    b.cylinder(0.025, 0.36, STEEL, side * 0.2, 0.52, 0.76, { x: 1.2 }, 6);
  }
  // Ripper.
  b.box(0.5, 0.06, 0.06, darken(yellow, 0.85), 0, 0.34, -0.78);
  b.box(0.06, 0.34, 0.06, DARK, 0, 0.17, -0.82, { x: 0.2 });
  b.use('glow');
  b.box(0.06, 0.06, 0.06, AMBER, 0.25, 1.12, -0.48);
  b.use('body');

  const group = new Group();
  group.name = 'vehicle-dozer';
  group.add(buildModel(b));
  group.add(pickBox(1.4, 1.3, 2.3, 0.55));
  return { group, rotor: null, tailRotor: null, props: [], blurDiscs: [], redLight: null, blueLight: null, length: 1.9, width: 0.9 };
}

/** Medium utility firefighting helicopter on skids, with a belly tank. */
function createHelicopter(): VehicleModel {
  const b = new ModelBuilder();
  const red = 0xb8322a;
  const belly = 0x3a3e3d;
  // Fuselage: glazed nose, cabin, then taper into the tail boom.
  b.loft(
    [
      { z: 1.76, w: 0.2, h: 0.22, y: 0.6, bevel: 0.45 },
      { z: 1.58, w: 0.56, h: 0.56, y: 0.62, bevel: 0.45 },
      { z: 1.16, w: 0.78, h: 0.82, y: 0.7, bevel: 0.4 },
      { z: 0.2, w: 0.82, h: 0.9, y: 0.72, bevel: 0.35 },
      { z: -0.72, w: 0.74, h: 0.78, y: 0.76, bevel: 0.4 },
      { z: -1.12, w: 0.34, h: 0.36, y: 0.9, bevel: 0.4 },
    ],
    red,
  );
  b.loft(
    [
      { z: -1.1, w: 0.26, h: 0.28, y: 0.92, bevel: 0.4 },
      { z: -2.72, w: 0.12, h: 0.14, y: 1.0, bevel: 0.4 },
    ],
    red,
  );
  // White cheat line and dark belly.
  for (const side of [-1, 1]) {
    b.box(0.012, 0.07, 1.7, WHITE, side * 0.405, 0.6, 0.3);
    b.box(0.01, 0.05, 1.5, WHITE, side * 0.12, 0.93, -1.9, { y: side * 0.03 });
  }
  b.box(0.7, 0.05, 1.9, belly, 0, 0.3, 0.25);
  // Cockpit glazing, cabin windows and doors.
  b.use('glass');
  b.quad([-0.3, 0.86, 1.52], [0.3, 0.86, 1.52], [0.3, 1.06, 1.24], [-0.3, 1.06, 1.24], 0x4f7a88);
  for (const side of [-1, 1]) {
    b.quad(
      side > 0 ? [0.3, 0.6, 1.5] : [-0.38, 0.72, 1.24],
      side > 0 ? [0.38, 0.72, 1.24] : [-0.3, 0.6, 1.5],
      side > 0 ? [0.38, 1.0, 1.24] : [-0.3, 0.88, 1.5],
      side > 0 ? [0.3, 0.88, 1.5] : [-0.38, 1.0, 1.24],
      0x4f7a88,
    );
    b.box(0.012, 0.3, 0.36, GLASS, side * 0.405, 0.86, 0.85);
    b.box(0.012, 0.26, 0.42, GLASS, side * 0.41, 0.86, 0.22);
    b.box(0.012, 0.2, 0.22, GLASS, side * 0.39, 0.88, -0.38);
  }
  b.use('body');
  // Engine cowling, exhausts, mast and hub.
  b.loft(
    [
      { z: 0.62, w: 0.36, h: 0.12, y: 1.16, bevel: 0.5 },
      { z: 0.4, w: 0.52, h: 0.26, y: 1.2, bevel: 0.45 },
      { z: -0.62, w: 0.5, h: 0.24, y: 1.2, bevel: 0.45 },
      { z: -0.95, w: 0.26, h: 0.14, y: 1.14, bevel: 0.45 },
    ],
    darken(red, 0.95),
  );
  for (const side of [-1, 1]) b.cylinder(0.05, 0.16, DARK, side * 0.2, 1.24, -0.72, { x: Math.PI / 2 - 0.3 }, 8);
  b.cylinder(0.05, 0.16, STEEL, 0, 1.38, 0.05, undefined, 8);
  b.cylinder(0.11, 0.07, DARK, 0, 1.47, 0.05, undefined, 8);
  // Tail: fin, stabiliser, tail-rotor gearbox.
  b.quad([0, 0.98, -2.42], [0, 0.98, -2.78], [0, 1.6, -2.96], [0, 1.6, -2.8], red);
  b.quad([0, 0.98, -2.78], [0, 0.98, -2.42], [0, 1.6, -2.8], [0, 1.6, -2.96], red);
  b.box(0.04, 0.05, 0.2, WHITE, 0, 1.58, -2.88);
  b.box(0.9, 0.03, 0.2, red, 0, 0.98, -2.2);
  for (const side of [-1, 1]) b.box(0.03, 0.14, 0.18, red, side * 0.45, 1.02, -2.22);
  b.box(0.1, 0.1, 0.12, DARK, 0.06, 1.42, -2.84);
  // Skids with cross tubes.
  for (const side of [-1, 1]) {
    b.cylinder(0.025, 2.1, DARK, side * 0.46, 0.04, 0.25, { x: Math.PI / 2 }, 6);
    b.cylinder(0.025, 0.22, DARK, side * 0.46, 0.09, 1.38, { x: Math.PI / 2 + 0.7 }, 6);
    for (const z of [0.85, -0.3]) b.cylinder(0.022, 0.42, DARK, side * 0.36, 0.2, z, { z: side * 0.55 }, 6);
  }
  // Belly tank and snorkel.
  b.loft(
    [
      { z: 0.85, w: 0.4, h: 0.12, y: 0.24, bevel: 0.5 },
      { z: 0.72, w: 0.62, h: 0.2, y: 0.24, bevel: 0.4 },
      { z: -0.5, w: 0.62, h: 0.2, y: 0.24, bevel: 0.4 },
      { z: -0.62, w: 0.4, h: 0.12, y: 0.25, bevel: 0.5 },
    ],
    0x8b918f,
  );
  b.cylinder(0.035, 0.22, DARK, 0.2, 0.08, 0.6, undefined, 6);
  b.use('glow');
  b.box(0.06, 0.04, 0.06, 0xff3020, 0, 1.33, -0.4);
  b.box(0.04, 0.04, 0.04, 0xff3020, -0.42, 0.98, -2.22);
  b.box(0.04, 0.04, 0.04, 0x3cff6a, 0.42, 0.98, -2.22);
  b.use('body');

  const group = new Group();
  group.name = 'vehicle-helicopter';
  group.add(buildModel(b));

  const rotor = new Group();
  rotor.name = 'rotor';
  rotor.position.set(0, 1.5, 0.05);
  const rotorBuilder = new ModelBuilder();
  for (let i = 0; i < 4; i += 1) {
    const angle = (i * Math.PI) / 2;
    rotorBuilder.push(0, 0, 0, { y: angle });
    rotorBuilder.box(2.3, 0.02, 0.13, 0x2a2d2b, 1.25, 0, 0);
    rotorBuilder.box(0.2, 0.021, 0.131, YELLOW, 2.3, 0, 0);
    rotorBuilder.pop();
  }
  rotorBuilder.cylinder(0.09, 0.05, STEEL, 0, 0.02, 0, undefined, 8);
  const rotorMesh = buildPart(rotorBuilder, MODEL_BODY);
  if (rotorMesh) rotor.add(rotorMesh);
  const disc = blurDisc(2.45);
  disc.rotation.x = -Math.PI / 2;
  rotor.add(disc);
  group.add(rotor);

  const tailRotor = new Group();
  tailRotor.name = 'tail-rotor';
  tailRotor.position.set(0.1, 1.42, -2.84);
  const tailBuilder = new ModelBuilder();
  tailBuilder.box(0.02, 0.86, 0.07, 0x2a2d2b, 0, 0, 0);
  tailBuilder.box(0.02, 0.07, 0.86, 0x2a2d2b, 0, 0, 0);
  const tailMesh = buildPart(tailBuilder, MODEL_BODY);
  if (tailMesh) tailRotor.add(tailMesh);
  group.add(tailRotor);

  group.add(pickBox(1.6, 1.6, 4.2, 0.8));
  return {
    group,
    rotor,
    tailRotor,
    props: [],
    blurDiscs: [disc],
    redLight: null,
    blueLight: null,
    length: 3.4,
    width: 0.9,
  };
}

/** Wing or tailplane panel from root to tip on one side (+x when `side` is 1). */
function wingPanel(
  b: ModelBuilder,
  side: number,
  root: { x: number; le: number; te: number; y: number; t: number },
  tip: { x: number; le: number; te: number; y: number; t: number },
  top: number,
  bottom = darken(top, 0.7),
): void {
  const s = side;
  const rlT = [s * root.x, root.y + root.t / 2, root.le];
  const rtT = [s * root.x, root.y + root.t / 2, root.te];
  const rlB = [s * root.x, root.y - root.t / 2, root.le];
  const rtB = [s * root.x, root.y - root.t / 2, root.te];
  const tlT = [s * tip.x, tip.y + tip.t / 2, tip.le];
  const ttT = [s * tip.x, tip.y + tip.t / 2, tip.te];
  const tlB = [s * tip.x, tip.y - tip.t / 2, tip.le];
  const ttB = [s * tip.x, tip.y - tip.t / 2, tip.te];
  if (s > 0) {
    b.quad(rlT, tlT, ttT, rtT, top);
    b.quad(rlB, rtB, ttB, tlB, bottom);
    b.quad(rlB, tlB, tlT, rlT, darken(top, 0.92));
    b.quad(rtB, rtT, ttT, ttB, darken(top, 0.85));
    b.quad(tlB, ttB, ttT, tlT, darken(top, 0.9));
  } else {
    b.quad(rlT, rtT, ttT, tlT, top);
    b.quad(rlB, tlB, ttB, rtB, bottom);
    b.quad(rlB, rlT, tlT, tlB, darken(top, 0.92));
    b.quad(rtB, ttB, ttT, rtT, darken(top, 0.85));
    b.quad(tlB, tlT, ttT, ttB, darken(top, 0.9));
  }
}

/** Twin-turboprop high-wing air tanker with a belly retardant tank. */
function createAirTanker(): VehicleModel {
  const b = new ModelBuilder();
  const white = 0xeeeae0;
  const red = 0xc0342a;
  const grey = 0x8d9391;
  // Fuselage.
  b.loft(
    [
      { z: 2.26, w: 0.16, h: 0.14, y: 0.84, bevel: 0.5, color: red },
      { z: 2.08, w: 0.46, h: 0.44, y: 0.83, bevel: 0.45 },
      { z: 1.76, w: 0.66, h: 0.66, y: 0.84, bevel: 0.42 },
      { z: 1.2, w: 0.72, h: 0.74, y: 0.85, bevel: 0.4 },
      { z: -0.45, w: 0.72, h: 0.74, y: 0.87, bevel: 0.4 },
      { z: -1.6, w: 0.38, h: 0.42, y: 1.0, bevel: 0.42 },
      { z: -2.24, w: 0.12, h: 0.16, y: 1.1, bevel: 0.45 },
    ],
    white,
  );
  // Livery: red cheat line, red belly fairing, anti-glare panel.
  for (const side of [-1, 1]) {
    b.box(0.012, 0.12, 3.2, red, side * 0.366, 0.74, 0.25);
    b.box(0.012, 0.04, 3.2, darken(red, 0.7), side * 0.367, 0.66, 0.25);
  }
  b.box(0.3, 0.012, 0.22, DARK, 0, 1.17, 1.72, { x: -0.25 });
  // Cockpit glazing and cabin windows.
  b.use('glass');
  b.quad([-0.25, 1.06, 1.88], [0.25, 1.06, 1.88], [0.22, 1.2, 1.62], [-0.22, 1.2, 1.62], GLASS);
  for (const side of [-1, 1]) {
    b.box(0.012, 0.13, 0.32, GLASS, side * 0.345, 1.04, 1.62);
    for (let i = 0; i < 4; i += 1) b.box(0.012, 0.1, 0.1, GLASS, side * 0.365, 0.98, 0.9 - i * 0.36);
  }
  b.use('body');
  // Retardant tank fairing with door seams.
  b.loft(
    [
      { z: 0.98, w: 0.36, h: 0.1, y: 0.47, bevel: 0.5 },
      { z: 0.78, w: 0.56, h: 0.2, y: 0.44, bevel: 0.4 },
      { z: -0.62, w: 0.56, h: 0.2, y: 0.44, bevel: 0.4 },
      { z: -0.86, w: 0.34, h: 0.1, y: 0.48, bevel: 0.5 },
    ],
    red,
  );
  for (let i = 0; i < 4; i += 1) b.box(0.5, 0.01, 0.012, darken(red, 0.6), 0, 0.335, 0.55 - i * 0.36);
  // High wing with dihedral; white with red tips.
  for (const side of [-1, 1]) {
    wingPanel(
      b,
      side,
      { x: 0.2, le: 0.74, te: -0.08, y: 1.2, t: 0.11 },
      { x: 3.0, le: 0.62, te: 0.12, y: 1.32, t: 0.07 },
      white,
    );
    wingPanel(
      b,
      side,
      { x: 3.0, le: 0.62, te: 0.12, y: 1.32, t: 0.07 },
      { x: 3.72, le: 0.56, te: 0.2, y: 1.36, t: 0.05 },
      red,
    );
    // Flap and aileron seams.
    b.box(2.6, 0.006, 0.012, darken(white, 0.75), side * 1.65, 1.29, 0.06);
  }
  b.box(0.42, 0.14, 0.86, white, 0, 1.18, 0.34);
  // Engine nacelles under the wing, with red cowl rings and exhausts.
  for (const side of [-1, 1]) {
    b.push(side * 1.22, 0, 0);
    b.loft(
      [
        { z: 1.34, w: 0.22, h: 0.22, y: 1.07, bevel: 0.5, color: red },
        { z: 1.24, w: 0.34, h: 0.34, y: 1.08, bevel: 0.45 },
        { z: 0.98, w: 0.34, h: 0.36, y: 1.08, bevel: 0.45 },
        { z: -0.1, w: 0.3, h: 0.32, y: 1.1, bevel: 0.45 },
        { z: -0.55, w: 0.12, h: 0.12, y: 1.14, bevel: 0.5 },
      ],
      grey,
    );
    b.cylinder(0.035, 0.18, DARK, side * 0.16, 1.03, 0.3, { x: Math.PI / 2 }, 6);
    b.cone(0.08, 0.16, DARK, 0, 1.07, 1.42, { x: Math.PI / 2 }, 8);
    // Main gear: strut and twin wheels.
    b.box(0.05, 0.62, 0.06, DARK, 0, 0.62, 0.36);
    for (const dx of [-0.07, 0.07]) b.cylinder(0.12, 0.07, TIRE, dx, 0.13, 0.36, { z: Math.PI / 2 }, 10);
    b.pop();
  }
  // Nose gear.
  b.box(0.04, 0.42, 0.04, DARK, 0, 0.43, 1.68);
  b.cylinder(0.09, 0.06, TIRE, 0, 0.1, 1.68, { z: Math.PI / 2 }, 10);
  // Tail: tall swept fin (red), tailplane with red tips.
  for (const s of [1, -1]) {
    const x = s * 0.03;
    const p1 = [x, 1.05, -1.42];
    const p2 = [x, 1.08, -2.24];
    const p3 = [x, 1.98, -2.3];
    const p4 = [x, 1.98, -2.02];
    if (s > 0) b.quad(p1, p2, p3, p4, red);
    else b.quad(p2, p1, p4, p3, red);
  }
  b.box(0.065, 0.06, 0.3, white, 0, 1.75, -2.2);
  for (const side of [-1, 1]) {
    wingPanel(
      b,
      side,
      { x: 0.06, le: -1.72, te: -2.18, y: 1.1, t: 0.05 },
      { x: 1.0, le: -1.92, te: -2.2, y: 1.12, t: 0.035 },
      white,
    );
    b.box(0.1, 0.04, 0.24, red, side * 0.98, 1.12, -2.06);
  }
  b.use('glow');
  b.box(0.06, 0.04, 0.06, 0xff3020, 0, 1.25, -0.5);
  b.box(0.05, 0.04, 0.08, 0xff3020, -3.72, 1.36, 0.4);
  b.box(0.05, 0.04, 0.08, 0x3cff6a, 3.72, 1.36, 0.4);
  b.box(0.04, 0.04, 0.04, 0xfff3d0, 0, 1.12, -2.25);
  b.use('body');

  const group = new Group();
  group.name = 'vehicle-tanker';
  group.add(buildModel(b));
  const props: Object3D[] = [];
  const blurDiscs: Mesh[] = [];
  for (const side of [-1, 1]) {
    const prop = new Group();
    prop.name = 'propeller';
    prop.position.set(side * 1.22, 1.07, 1.46);
    const propBuilder = new ModelBuilder();
    for (let i = 0; i < 4; i += 1) {
      propBuilder.push(0, 0, 0, { z: (i * Math.PI) / 2 });
      propBuilder.box(0.07, 0.56, 0.02, 0x232523, 0, 0.3, 0);
      propBuilder.box(0.071, 0.07, 0.021, YELLOW, 0, 0.55, 0);
      propBuilder.pop();
    }
    const propMesh = buildPart(propBuilder, MODEL_BODY);
    if (propMesh) prop.add(propMesh);
    const disc = blurDisc(0.6);
    prop.add(disc);
    blurDiscs.push(disc);
    props.push(prop);
    group.add(prop);
  }
  group.add(pickBox(3.2, 1.6, 4.6, 0.9));
  return { group, rotor: null, tailRotor: null, props, blurDiscs, redLight: null, blueLight: null, length: 4.4, width: 7.4 };
}

export function createUnitShadow(): Mesh {
  const shadow = new Mesh(
    new CircleGeometry(0.55, 16),
    new MeshBasicMaterial({ color: 0x0b0f0b, transparent: true, opacity: 0.16, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.05;
  return shadow;
}
