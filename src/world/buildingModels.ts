import { Rng } from '../core/rng';
import { darken, mix, ModelBuilder } from '../core/modelBuilder';

/**
 * Procedural building models at the world prop scale (1 unit ≈ 3 m: a storey
 * is about one unit, a door about 0.7). Each model is drawn into a
 * ModelBuilder in lot space: the lot is `width` × `depth` units centred on the
 * origin, and the street is on the +z side. Signs that need canvas text are
 * returned separately.
 */
export type BuildingKind =
  | 'house'
  | 'twostory'
  | 'ranch'
  | 'barn'
  | 'cabin'
  | 'store'
  | 'chapel'
  | 'station'
  | 'aframe'
  | 'trailer'
  | 'gas'
  | 'school'
  | 'motel'
  | 'shop';

export const BUILDING_KINDS: ReadonlyArray<BuildingKind> = [
  'house',
  'twostory',
  'ranch',
  'barn',
  'cabin',
  'store',
  'chapel',
  'station',
  'aframe',
  'trailer',
  'gas',
  'school',
  'motel',
  'shop',
];

export const BUILDING_LABELS: Record<BuildingKind, string> = {
  house: 'House',
  twostory: 'Farmhouse',
  ranch: 'Ranch house',
  barn: 'Barn',
  cabin: 'Cabin',
  store: 'Storefront',
  chapel: 'Chapel',
  station: 'Fire station',
  aframe: 'A-frame cabin',
  trailer: 'Mobile home',
  gas: 'Gas station',
  school: 'Schoolhouse',
  motel: 'Motel',
  shop: 'Workshop',
};

/** Lot frontage in tiles (depth is always two tiles). */
export const LOT_FRONTAGE: Record<BuildingKind, number> = {
  house: 2,
  twostory: 2,
  ranch: 3,
  barn: 3,
  cabin: 2,
  store: 2,
  chapel: 2,
  station: 3,
  aframe: 2,
  trailer: 3,
  gas: 3,
  school: 3,
  motel: 3,
  shop: 2,
};

export interface SignSpec {
  text: string;
  background: string;
  w: number;
  h: number;
  x: number;
  y: number;
  z: number;
  /** Rotation about y (0 = facing the street). */
  rotation: number;
}

export interface BuildingModel {
  intact: ModelBuilder;
  rubble: ModelBuilder;
  signs: SignSpec[];
  /** Height of the tallest part, for effects. */
  height: number;
}

interface Palette {
  wall: number;
  roof: number;
  trim: number;
  accent: number;
}

const GLASS = 0x34505e;
const DOOR = 0x6b4a33;
const CONCRETE = 0xa9a59b;
const ASPHALT = 0x4a4b48;
const BRICK = 0x8e4b3a;
const STONE = 0x8a857b;
const WOOD = 0x8a6844;
const WOOD_DARK = 0x5e4430;
const LOG = 0x6e4c30;
const METAL = 0x9aa3a3;
const DARK = 0x2e312f;
const TIRE = 0x1c1d1c;
const LAWN = 0x6f8f45;
const CAR_COLORS = [0x7b2f2a, 0x2f4e6e, 0xb9b4a6, 0x3e5a3a, 0x8a8f91, 0x23272a, 0xc9a04a, 0x6a3f5e];

const WALLS = [0xc9b48c, 0xd4bc96, 0xb6bea8, 0xd6ab8a, 0xadbfc2, 0xe3dccb, 0xa9b98f];
const ROOFS = [0x5b4438, 0x6e3f36, 0x4e4e4e, 0x75593f, 0x3f4b55, 0x5a5f4a];
const TRIMS = [0xf1ebdc, 0xe4dbc6, 0x4b3b2f, 0xf3efe6];
const ACCENTS = [0x2f4a5f, 0x7c2f27, 0x3e5a3a, 0x5b3d58, 0x2d3f5c];

function palette(rng: Rng): Palette {
  return {
    wall: rng.pick(WALLS),
    roof: rng.pick(ROOFS),
    trim: rng.pick(TRIMS),
    accent: rng.pick(ACCENTS),
  };
}

type Face = 'front' | 'back' | 'left' | 'right';

/**
 * A framed window on a wall face. `x`/`z` locate the wall plane: for front and
 * back faces `z` is the wall plane and `x` the window centre; for left/right
 * faces `x` is the plane and `z` the centre.
 */
function windowOn(
  b: ModelBuilder,
  face: Face,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  trim: number,
  shutters: number | null = null,
): void {
  const out = face === 'front' || face === 'right' ? 1 : -1;
  const alongZ = face === 'left' || face === 'right';
  const t = 0.03;
  const place = (along: number, up: number, depthOut: number, sw: number, sh: number, color: number) => {
    if (alongZ) b.box(t, sh, sw, color, x + out * depthOut, y + up, z + along);
    else b.box(sw, sh, t, color, x + along, y + up, z + out * depthOut);
  };
  place(0, 0, 0.01, w + 0.08, h + 0.08, trim);
  b.use('glass');
  place(0, 0, 0.02, w, h, GLASS);
  b.use('body');
  place(0, 0, 0.03, 0.025, h, trim);
  place(0, 0, 0.03, w, 0.025, trim);
  place(0, -h / 2 - 0.04, 0.035, w + 0.14, 0.035, trim);
  if (shutters !== null) {
    for (const s of [-1, 1]) place(s * (w / 2 + 0.09), 0, 0.02, 0.1, h + 0.04, shutters);
  }
}

function doorOn(b: ModelBuilder, face: Face, x: number, z: number, w: number, h: number, trim: number, color = DOOR, y0 = 0.08): void {
  const out = face === 'front' || face === 'right' ? 1 : -1;
  const alongZ = face === 'left' || face === 'right';
  const y = y0 + h / 2;
  if (alongZ) {
    b.box(0.03, h + 0.06, w + 0.1, trim, x + out * 0.01, y + 0.02, z);
    b.box(0.04, h, w, color, x + out * 0.02, y, z);
    b.box(0.05, 0.03, 0.03, 0xc9a548, x + out * 0.03, y, z + w * 0.3);
  } else {
    b.box(w + 0.1, h + 0.06, 0.03, trim, x, y + 0.02, z + out * 0.01);
    b.box(w, h, 0.04, color, x, y, z + out * 0.02);
    b.box(0.03, 0.03, 0.05, 0xc9a548, x + w * 0.3, y, z + out * 0.03);
  }
}

function foundation(b: ModelBuilder, w: number, d: number, x = 0, z = 0, h = 0.1): void {
  b.block(w + 0.06, h, d + 0.06, CONCRETE, x, 0, z);
}

function chimney(b: ModelBuilder, x: number, z: number, top: number, color = BRICK): void {
  b.block(0.26, top, 0.26, color, x, 0, z);
  b.block(0.32, 0.05, 0.32, darken(color, 0.8), x, top, z);
  b.block(0.12, 0.08, 0.12, DARK, x, top + 0.05, z);
}

/** Sedan or pickup, nose along +z, for driveways and lots. */
export function car(b: ModelBuilder, x: number, z: number, rotation: number, color: number, pickup = false): void {
  b.push(x, 0, z, { y: rotation });
  const length = pickup ? 1.78 : 1.52;
  const half = length / 2;
  b.block(0.6, 0.2, length, color, 0, 0.1, 0);
  for (const sx of [-0.27, 0.27]) {
    for (const sz of [half - 0.3, -half + 0.3]) b.cylinder(0.11, 0.08, TIRE, sx, 0.11, sz, { z: Math.PI / 2 }, 8);
  }
  if (pickup) {
    b.block(0.58, 0.24, 0.56, color, 0, 0.3, 0.12);
    b.block(0.6, 0.12, 0.74, darken(color, 0.85), 0, 0.3, -0.5);
    b.block(0.5, 0.05, 0.66, DARK, 0, 0.3, -0.5);
    b.use('glass');
    b.box(0.5, 0.15, 0.02, GLASS, 0, 0.44, 0.41);
    for (const s of [-1, 1]) b.box(0.02, 0.12, 0.34, GLASS, s * 0.295, 0.45, 0.14);
    b.use('body');
  } else {
    b.block(0.56, 0.2, 0.8, color, 0, 0.3, -0.06);
    b.use('glass');
    b.quad([-0.26, 0.31, 0.38], [0.26, 0.31, 0.38], [0.24, 0.48, 0.24], [-0.24, 0.48, 0.24], GLASS);
    b.quad([0.26, 0.31, -0.48], [-0.26, 0.31, -0.48], [-0.24, 0.48, -0.38], [0.24, 0.48, -0.38], GLASS);
    for (const s of [-1, 1]) b.box(0.02, 0.13, 0.6, GLASS, s * 0.285, 0.41, -0.05);
    b.use('body');
  }
  b.use('glow');
  for (const s of [-0.2, 0.2]) {
    b.box(0.1, 0.05, 0.02, 0xfff0c8, s, 0.24, half + 0.005);
    b.box(0.08, 0.05, 0.02, 0xd8261c, s, 0.24, -half - 0.005);
  }
  b.use('body');
  b.pop();
}

function mailbox(b: ModelBuilder, x: number, z: number, color = 0x4e5b63): void {
  b.block(0.05, 0.36, 0.05, WOOD, x, 0, z);
  b.block(0.1, 0.09, 0.18, color, x, 0.36, z);
}

/** Picket or rail fence around the back and sides of the lot. */
function fence(b: ModelBuilder, hw: number, back: number, front: number, color: number, picket: boolean): void {
  const runs: Array<[number, number, number, number]> = [
    [-hw, back, hw, back],
    [-hw, back, -hw, front],
    [hw, back, hw, front],
  ];
  for (const [ax, az, bx, bz] of runs) {
    const length = Math.hypot(bx - ax, bz - az);
    const alongX = Math.abs(bx - ax) > Math.abs(bz - az);
    for (const y of picket ? [0.2] : [0.16, 0.3]) {
      if (alongX) b.box(length, 0.03, 0.025, color, (ax + bx) / 2, y, az);
      else b.box(0.025, 0.03, length, color, ax, y, (az + bz) / 2);
    }
    const step = picket ? 0.14 : 0.5;
    const count = Math.max(2, Math.round(length / step));
    for (let i = 0; i <= count; i += 1) {
      const t = i / count;
      b.block(0.03, picket ? 0.3 : 0.36, 0.03, color, ax + (bx - ax) * t, 0, az + (bz - az) * t);
    }
  }
}

function porch(b: ModelBuilder, w: number, depth: number, frontZ: number, roofY: number, deck: number, trim: number, roof: number): void {
  b.block(w, 0.1, depth, deck, 0, 0, frontZ + depth / 2);
  b.block(w * 0.3, 0.05, 0.2, darken(deck, 0.9), 0, 0, frontZ + depth + 0.1);
  for (const s of [-1, 1]) b.block(0.05, roofY - 0.1, 0.05, trim, s * (w / 2 - 0.04), 0.1, frontZ + depth - 0.04);
  b.box(w - 0.1, 0.03, 0.03, trim, 0, 0.36, frontZ + depth - 0.04);
  b.push(0, roofY, frontZ + depth / 2, { x: 0.18 });
  b.box(w + 0.1, 0.05, depth + 0.12, roof, 0, 0, 0);
  b.pop();
}

function shrubs(b: ModelBuilder, rng: Rng, xs: number[], z: number): void {
  for (const x of xs) {
    const r = rng.range(0.14, 0.22);
    b.sphere(r, r * 0.8, r, rng.pick([0x4f7a3c, 0x5d8a45, 0x466e36]), x, r * 0.7, z, 6);
  }
}

function driveway(b: ModelBuilder, x: number, fromZ: number, toZ: number, width = 0.8, color = CONCRETE): void {
  b.block(width, 0.02, toZ - fromZ, color, x, 0, (fromZ + toZ) / 2);
}

// ---- building types -----------------------------------------------------

/** Single-storey gable house: porch, chimney, driveway with a car, fence. */
function house(b: ModelBuilder, w: number, d: number, rng: Rng, p: Palette): number {
  const bw = 2.6;
  const bd = 2.0;
  const bx = -0.45;
  const bz = -0.35;
  const eave = 0.95;
  const front = bz + bd / 2;
  b.push(bx, 0, bz);
  foundation(b, bw, bd);
  b.block(bw, eave, bd, p.wall, 0, 0.1, 0);
  b.gableRoof(bw + 0.3, bd + 0.34, 0.8, p.roof, eave + 0.1, p.wall);
  b.box(bw + 0.32, 0.05, 0.06, darken(p.roof, 0.7), 0, eave + 0.92, 0);
  doorOn(b, 'front', 0.15, bd / 2, 0.3, 0.62, p.trim, p.accent);
  for (const x of [-0.75, 0.85]) windowOn(b, 'front', x, 0.6, bd / 2, 0.42, 0.36, p.trim, rng.next() < 0.5 ? p.accent : null);
  for (const z of [-0.45, 0.45]) {
    windowOn(b, 'left', -bw / 2, 0.6, z, 0.38, 0.34, p.trim);
    windowOn(b, 'right', bw / 2, 0.6, z, 0.38, 0.34, p.trim);
  }
  windowOn(b, 'back', 0, 0.6, -bd / 2, 0.6, 0.34, p.trim);
  chimney(b, 0.75, -0.35, eave + 0.95);
  // Air-conditioner on the side.
  b.block(0.28, 0.24, 0.24, METAL, bw / 2 + 0.16, 0.02, -0.5);
  if (rng.next() < 0.7) porch(b, 1.5, 0.45, bd / 2, eave - 0.05, WOOD, p.trim, p.roof);
  b.pop();
  shrubs(b, rng, [bx - 1.0, bx - 0.4, bx + 0.6], front + 0.12);
  driveway(b, w / 2 - 0.5, front - 1.2, d / 2, 0.75);
  car(b, w / 2 - 0.5, front - 0.45, Math.PI, rng.pick(CAR_COLORS), rng.next() < 0.45);
  mailbox(b, w / 2 - 1.05, d / 2 - 0.12);
  if (rng.next() < 0.6) fence(b, w / 2 + 0.45, -d / 2 - 0.4, front - 0.4, rng.next() < 0.6 ? 0xece6d6 : WOOD, rng.next() < 0.6);
  return eave + 1.0;
}

/** Two-storey farmhouse: tall gable, front dormer, wraparound porch. */
function twostory(b: ModelBuilder, w: number, d: number, rng: Rng, p: Palette): number {
  const bw = 2.5;
  const bd = 2.0;
  const bz = -0.3;
  const eave = 1.95;
  const front = bz + bd / 2;
  b.push(0, 0, bz);
  foundation(b, bw, bd, 0, 0, 0.14);
  b.block(bw, eave, bd, p.wall, 0, 0.14, 0);
  b.box(bw + 0.03, 0.05, bd + 0.03, p.trim, 0, 1.08, 0);
  b.gableRoof(bw + 0.26, bd + 0.3, 1.0, p.roof, eave + 0.14, p.wall);
  for (const x of [-0.7, 0.7]) {
    windowOn(b, 'front', x, 0.66, bd / 2, 0.34, 0.46, p.trim, p.accent);
    windowOn(b, 'front', x, 1.58, bd / 2, 0.34, 0.46, p.trim, p.accent);
  }
  windowOn(b, 'front', 0, 1.58, bd / 2, 0.3, 0.4, p.trim);
  doorOn(b, 'front', 0, bd / 2, 0.3, 0.66, p.trim, p.accent, 0.14);
  for (const z of [-0.45, 0.45]) {
    for (const y of [0.66, 1.58]) {
      windowOn(b, 'left', -bw / 2, y, z, 0.32, 0.44, p.trim);
      windowOn(b, 'right', bw / 2, y, z, 0.32, 0.44, p.trim);
    }
  }
  // Dormer.
  b.block(0.6, 0.44, 0.5, p.wall, 0, eave + 0.14, bd / 2 - 0.42);
  b.gableRoof(0.74, 0.6, 0.28, p.roof, eave + 0.58, p.wall, 0, bd / 2 - 0.42);
  windowOn(b, 'front', 0, eave + 0.36, bd / 2 - 0.16, 0.28, 0.26, p.trim);
  chimney(b, -0.8, -0.2, eave + 1.15);
  porch(b, bw + 0.2, 0.55, bd / 2, 1.0, WOOD, p.trim, p.roof);
  b.pop();
  shrubs(b, rng, [-1.0, 1.0], front + 0.62);
  b.block(0.36, 0.02, d / 2 - front - 0.6, CONCRETE, 0, 0, (front + 0.6 + d / 2) / 2);
  mailbox(b, w / 2 - 0.4, d / 2 - 0.12);
  if (rng.next() < 0.6) car(b, w / 2 + 0.1, -0.8, 0.1, rng.pick(CAR_COLORS), true);
  if (rng.next() < 0.5) fence(b, w / 2 + 0.45, -d / 2 - 0.4, front - 0.4, WOOD, false);
  return eave + 1.2;
}

/** Long low ranch house: hip roof, attached two-car garage, picture window. */
function ranch(b: ModelBuilder, w: number, d: number, rng: Rng, p: Palette): number {
  const bw = 4.4;
  const bd = 2.1;
  const bz = -0.3;
  const eave = 0.9;
  const front = bz + bd / 2;
  b.push(0, 0, bz);
  foundation(b, bw, bd);
  b.block(bw, eave, bd, p.wall, 0, 0.1, 0);
  b.hipRoof(bw + 0.36, bd + 0.36, 0.62, p.roof, eave + 0.1);
  // Brick wainscot on the living wing.
  b.box(2.6, 0.32, 0.02, BRICK, -0.85, 0.26, bd / 2 + 0.01);
  // Garage: two doors with panel lines.
  for (const x of [1.1, 1.75]) {
    b.box(0.56, 0.62, 0.03, 0xe0dacb, x, 0.41, bd / 2 + 0.015);
    for (let i = 1; i < 4; i += 1) b.box(0.54, 0.012, 0.035, darken(0xe0dacb, 0.8), x, 0.1 + i * 0.155, bd / 2 + 0.02);
  }
  windowOn(b, 'front', -1.2, 0.6, bd / 2, 0.9, 0.42, p.trim);
  windowOn(b, 'front', -0.1, 0.62, bd / 2, 0.36, 0.32, p.trim);
  doorOn(b, 'front', 0.45, bd / 2, 0.28, 0.62, p.trim, p.accent);
  for (const z of [-0.4, 0.4]) windowOn(b, 'left', -bw / 2, 0.6, z, 0.4, 0.34, p.trim);
  windowOn(b, 'back', -1.0, 0.6, -bd / 2, 0.7, 0.34, p.trim);
  windowOn(b, 'back', 0.6, 0.6, -bd / 2, 0.4, 0.34, p.trim);
  chimney(b, -1.5, 0.1, eave + 0.85, STONE);
  b.pop();
  driveway(b, 1.42, front, d / 2, 1.3);
  car(b, 1.1, front + 0.85, Math.PI, rng.pick(CAR_COLORS));
  if (rng.next() < 0.5) car(b, 1.78, front + 0.9, Math.PI, rng.pick(CAR_COLORS), true);
  shrubs(b, rng, [-2.0, -1.5, -0.4], front + 0.15);
  mailbox(b, 2.4, d / 2 - 0.12);
  if (rng.next() < 0.6) fence(b, w / 2 + 0.4, -d / 2 - 0.45, front - 0.35, 0xece6d6, true);
  return eave + 0.75;
}

/** Red gambrel barn with big X-braced doors, hayloft, and a silo or hay bales. */
function barn(b: ModelBuilder, w: number, d: number, rng: Rng): number {
  const red = rng.pick([0x9a3a2c, 0x8e3f31, 0xa3452f, 0x7c5a3f]);
  const trim = 0xebe2cb;
  const roof = rng.pick([0x4a4846, 0x4a312b, 0x5c5f5a]);
  const bw = 3.6;
  const bd = 2.8;
  const eave = 1.4;
  const bz = -0.2;
  b.push(-0.4, 0, bz);
  b.block(bw, eave, bd, red, 0, 0, 0);
  b.gambrelRoof(bw + 0.24, bd + 0.24, 1.55, roof, eave, red);
  // Gable trim along the gambrel.
  const front = bd / 2;
  // Big sliding doors with an X brace.
  b.box(1.5, 1.1, 0.03, red, 0, 0.55, front + 0.02);
  for (const s of [-1, 1]) {
    b.box(1.6, 0.05, 0.04, trim, 0, s > 0 ? 1.1 : 0.03, front + 0.035);
    b.box(0.05, 1.1, 0.04, trim, s * 0.77, 0.55, front + 0.035);
    b.box(0.05, 1.1, 0.04, trim, s * 0.0, 0.55, front + 0.036);
    b.push(s * 0.38, 0.55, front + 0.04, { z: s * 0.97 });
    b.box(0.04, 1.3, 0.03, trim, 0, 0, 0);
    b.pop();
    b.push(s * 0.38, 0.55, front + 0.04, { z: -s * 0.97 });
    b.box(0.04, 1.3, 0.03, trim, 0, 0, 0);
    b.pop();
  }
  b.box(1.7, 0.05, 0.06, DARK, 0, 1.18, front + 0.04);
  // Hayloft door and hood.
  b.box(0.6, 0.5, 0.03, red, 0, 1.75, front + 0.06);
  b.box(0.7, 0.06, 0.04, trim, 0, 2.02, front + 0.07);
  b.box(0.06, 0.5, 0.04, trim, -0.33, 1.75, front + 0.07);
  b.box(0.06, 0.5, 0.04, trim, 0.33, 1.75, front + 0.07);
  b.box(0.7, 0.1, 0.4, roof, 0, 2.6, front + 0.12);
  // Side windows.
  for (const z of [-0.8, 0, 0.8]) windowOn(b, 'right', bw / 2, 0.9, z, 0.32, 0.3, trim);
  b.pop();
  if (rng.next() < 0.6) {
    const sx = -0.4 - bw / 2 - 0.62;
    b.cylinder(0.55, 3.6, 0xb7bcbc, sx, 1.8, -0.5, undefined, 14);
    for (let i = 1; i < 6; i += 1) b.cylinder(0.565, 0.04, 0x9aa0a0, sx, i * 0.6, -0.5, undefined, 14);
    b.sphere(0.56, 0.4, 0.56, 0x8a9192, sx, 3.6, -0.5, 14, true);
  } else {
    for (let i = 0; i < 4; i += 1) {
      b.cylinder(0.24, 0.36, 0xd2b064, w / 2 - 0.25, 0.24, -0.9 + i * 0.52, { z: Math.PI / 2 }, 10);
    }
  }
  // Fenced paddock in front of the side.
  fence(b, w / 2 + 0.5, -d / 2 - 0.4, d / 2 - 0.6, WOOD, false);
  return eave + 1.6;
}

/** Log cabin: notched log walls, steep roof, stone chimney, porch and woodpile. */
function cabin(b: ModelBuilder, _w: number, d: number, rng: Rng): number {
  const roof = rng.pick([0x3e332c, 0x4a4036, 0x3f4a3a]);
  const bw = 2.4;
  const bd = 1.9;
  const eave = 0.95;
  const bz = -0.3;
  b.push(0, 0, bz);
  b.block(bw + 0.06, 0.12, bd + 0.06, STONE, 0, 0, 0);
  // Log courses with alternating shades and corner overhangs.
  const courses = 8;
  for (let i = 0; i < courses; i += 1) {
    const y = 0.12 + (i + 0.5) * ((eave - 0.12) / courses);
    const color = i % 2 === 0 ? LOG : darken(LOG, 1.12);
    b.cylinder(0.06, bw + 0.24, color, 0, y, bd / 2, { z: Math.PI / 2 }, 6);
    b.cylinder(0.06, bw + 0.24, color, 0, y, -bd / 2, { z: Math.PI / 2 }, 6);
    b.cylinder(0.06, bd + 0.24, color, -bw / 2, y + 0.05, 0, { x: Math.PI / 2 }, 6);
    b.cylinder(0.06, bd + 0.24, color, bw / 2, y + 0.05, 0, { x: Math.PI / 2 }, 6);
  }
  b.block(bw - 0.04, eave - 0.12, bd - 0.04, darken(LOG, 0.9), 0, 0.12, 0);
  b.gableRoof(bw + 0.44, bd + 0.5, 0.95, roof, eave, darken(LOG, 1.1));
  doorOn(b, 'front', -0.35, bd / 2 + 0.05, 0.3, 0.6, WOOD_DARK, 0x5a3b26, 0.12);
  windowOn(b, 'front', 0.5, 0.58, bd / 2 + 0.05, 0.38, 0.32, WOOD_DARK);
  windowOn(b, 'left', -bw / 2 - 0.05, 0.58, 0, 0.36, 0.3, WOOD_DARK);
  windowOn(b, 'front', 0, eave + 0.38, bd / 2 + 0.03, 0.28, 0.24, WOOD_DARK);
  // Stone chimney on the gable end.
  b.block(0.42, eave + 1.15, 0.42, STONE, bw / 2 + 0.2, 0, -0.1);
  b.block(0.3, 0.1, 0.3, darken(STONE, 0.8), bw / 2 + 0.2, eave + 1.15, -0.1);
  porch(b, bw, 0.5, bd / 2, eave - 0.1, WOOD, WOOD_DARK, roof);
  b.pop();
  // Woodpile and chopping block.
  b.block(0.8, 0.32, 0.3, LOG, -bw / 2 - 0.45, 0, -0.6, { y: Math.PI / 2 });
  b.cylinder(0.12, 0.2, WOOD, -bw / 2 - 0.3, 0.1, 0.3, undefined, 8);
  if (rng.next() < 0.6) car(b, 1.45, d / 2 - 0.9, 0.2, rng.pick([0x4a5a3a, 0x6a3a2a, 0x3a3a3a]), true);
  return eave + 1.0;
}

/** Western false-front store: parapet with a painted sign, awning, boardwalk. */
function store(b: ModelBuilder, w: number, d: number, rng: Rng, signs: SignSpec[]): number {
  const fronts = [0xb8865a, 0x8f6b4a, 0xc9b28a, 0x7f8f88, 0xa9654b, 0x6f7f9a];
  const wall = rng.pick(fronts);
  const trim = 0xefe4ca;
  const bw = 3.2;
  const bd = 2.5;
  const eave = 1.25;
  const bz = -0.35;
  const front = bz + bd / 2;
  b.push(0, 0, bz);
  foundation(b, bw, bd);
  b.block(bw, eave, bd, wall, 0, 0.1, 0);
  b.block(bw + 0.06, 0.08, bd + 0.06, darken(wall, 0.6), 0, eave + 0.1, 0);
  // False front with stepped cap.
  b.block(bw + 0.12, 0.75, 0.1, wall, 0, eave + 0.1, bd / 2 - 0.05);
  b.block(bw + 0.24, 0.07, 0.16, trim, 0, eave + 0.85, bd / 2 - 0.05);
  b.block(1.2, 0.18, 0.12, wall, 0, eave + 0.92, bd / 2 - 0.05);
  b.block(1.3, 0.05, 0.16, trim, 0, eave + 1.1, bd / 2 - 0.05);
  // Shopfront: big windows each side of the door, transom band.
  for (const x of [-0.95, 0.95]) windowOn(b, 'front', x, 0.62, bd / 2, 0.86, 0.6, trim);
  doorOn(b, 'front', 0, bd / 2, 0.36, 0.72, trim, 0x5b3a26);
  b.box(bw, 0.06, 0.03, trim, 0, 1.05, bd / 2 + 0.01);
  for (const z of [-0.6, 0.4]) windowOn(b, 'left', -bw / 2, 0.7, z, 0.3, 0.4, trim);
  // Awning on posts over a boardwalk.
  const awning = rng.pick([0x9c3b31, 0x2f6a5c, 0x3d5a8a, 0xb88a2e]);
  b.push(0, 1.05, bd / 2 + 0.38, { x: 0.22 });
  b.box(bw + 0.1, 0.04, 0.8, awning, 0, 0, 0);
  for (let i = 0; i < 6; i += 1) b.box(0.25, 0.042, 0.8, darken(awning, 1.25), -bw / 2 + 0.3 + i * 0.52, 0.002, 0);
  b.pop();
  b.block(bw + 0.1, 0.08, 0.85, WOOD, 0, 0, bd / 2 + 0.42);
  for (const x of [-bw / 2 + 0.05, 0, bw / 2 - 0.05]) b.block(0.05, 0.98, 0.05, trim, x, 0.08, bd / 2 + 0.8);
  b.cylinder(0.1, 0.24, WOOD_DARK, bw / 2 - 0.3, 0.2, bd / 2 + 0.6, undefined, 8);
  b.block(0.6, 0.06, 0.2, WOOD, -0.95, 0.24, bd / 2 + 0.62);
  b.pop();
  const names = ['GENERAL STORE', 'CAFE', 'HARDWARE', 'FEED & SUPPLY', 'POST OFFICE', 'DINER', 'BAKERY', 'SALOON'];
  signs.push({
    text: rng.pick(names),
    background: rng.pick(['#7c2f27', '#2f4a3a', '#2d3f5c', '#5c3a22']),
    w: bw * 0.86,
    h: 0.42,
    x: 0,
    y: eave + 0.5,
    z: front + 0.012,
    rotation: 0,
  });
  if (rng.next() < 0.7) car(b, w / 2 + 0.05, d / 2 - 0.1, Math.PI / 2, rng.pick(CAR_COLORS), rng.next() < 0.5);
  return eave + 1.2;
}

/** White chapel, gable to the street, steeple with a belfry, tall windows. */
function chapel(b: ModelBuilder, _w: number, d: number, rng: Rng): number {
  const wall = 0xeee8da;
  const roof = rng.pick([0x55606a, 0x4a4e52, 0x6e3f36]);
  const trim = 0xfaf6ec;
  const bw = 1.9;
  const bd = 3.0;
  const eave = 1.35;
  const bz = -0.35;
  b.push(0, 0, bz);
  foundation(b, bw, bd, 0, 0, 0.16);
  b.block(bw, eave, bd, wall, 0, 0.16, 0);
  // Ridge along z: build the gable roof rotated a quarter turn.
  b.push(0, 0, 0, { y: Math.PI / 2 });
  b.gableRoof(bd + 0.3, bw + 0.32, 1.1, roof, eave + 0.16, wall);
  b.pop();
  // Steeple: square tower, belfry, spire, cross.
  const tz = bd / 2 - 0.3;
  b.block(0.62, eave + 1.0, 0.62, wall, 0, 0.16, tz);
  b.block(0.66, 0.05, 0.66, trim, 0, eave + 1.16, tz);
  // Open belfry: corner posts round a dark core with a bell.
  b.block(0.36, 0.42, 0.36, DARK, 0, eave + 1.2, tz);
  for (const [px, pz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) b.block(0.1, 0.42, 0.1, wall, px * 0.26, eave + 1.2, tz + pz * 0.26);
  b.cone(0.1, 0.14, 0xb58a3a, 0, eave + 1.46, tz, undefined, 8);
  b.block(0.7, 0.06, 0.7, trim, 0, eave + 1.62, tz);
  b.cone(0.48, 1.25, roof, 0, eave + 2.3, tz, { y: Math.PI / 4 }, 4);
  b.box(0.04, 0.32, 0.04, 0xc9a548, 0, eave + 3.08, tz);
  b.box(0.18, 0.04, 0.04, 0xc9a548, 0, eave + 3.12, tz);
  doorOn(b, 'front', 0, tz + 0.31, 0.32, 0.72, trim, 0x7a3a2a, 0.16);
  windowOn(b, 'front', 0, eave + 0.7, tz + 0.31, 0.2, 0.3, trim);
  for (const z of [-0.95, -0.25, 0.45]) {
    windowOn(b, 'left', -bw / 2, 0.82, z, 0.22, 0.62, trim);
    windowOn(b, 'right', bw / 2, 0.82, z, 0.22, 0.62, trim);
  }
  b.block(0.8, 0.08, 0.3, CONCRETE, 0, 0, bd / 2 + 0.15);
  b.pop();
  b.block(0.3, 0.02, d / 2 - (bz + bd / 2) - 0.3, CONCRETE, 0, 0, (bz + bd / 2 + 0.3 + d / 2) / 2);
  shrubs(b, rng, [-0.8, 0.8], bz + bd / 2 + 0.2);
  return eave + 3.2;
}

/** Fire station: two apparatus bays, office wing, hose tower, flagpole. */
function station(b: ModelBuilder, w: number, d: number, signs: SignSpec[]): number {
  const wall = 0xd9d3bd;
  const brick = 0x9a4a38;
  const trim = 0xf0e6cc;
  const red = 0xa9302a;
  const bw = 4.2;
  const bd = 2.6;
  const eave = 1.75;
  const bz = -0.4;
  b.push(-0.4, 0, bz);
  foundation(b, bw, bd);
  b.block(bw, eave, bd, brick, 0, 0.1, 0);
  b.block(bw + 0.1, 0.16, bd + 0.1, wall, 0, eave + 0.1, 0);
  b.block(bw - 0.2, 0.05, bd - 0.2, 0x5d5a55, 0, eave + 0.26, 0);
  // Two bay doors with window bands.
  for (const x of [-1.1, 0.25]) {
    b.box(1.08, 1.32, 0.04, 0xe6e2d8, x, 0.76, bd / 2 + 0.02);
    for (let i = 1; i < 6; i += 1) b.box(1.06, 0.015, 0.045, 0xbab5aa, x, 0.1 + i * 0.22, bd / 2 + 0.025);
    b.use('glass');
    b.box(0.9, 0.1, 0.05, GLASS, x, 1.0, bd / 2 + 0.03);
    b.use('body');
    b.box(1.2, 0.08, 0.06, trim, x, 1.46, bd / 2 + 0.03);
    b.box(0.08, 1.4, 0.06, trim, x - 0.58, 0.76, bd / 2 + 0.03);
    b.box(0.08, 1.4, 0.06, trim, x + 0.58, 0.76, bd / 2 + 0.03);
  }
  // Office wing with door and windows.
  doorOn(b, 'front', 1.45, bd / 2, 0.3, 0.66, trim, red);
  windowOn(b, 'front', 1.45, 1.25, bd / 2, 0.4, 0.34, trim);
  for (const z of [-0.6, 0.4]) {
    windowOn(b, 'right', bw / 2, 0.62, z, 0.4, 0.36, trim);
    windowOn(b, 'right', bw / 2, 1.3, z, 0.4, 0.36, trim);
  }
  // Hose-drying tower.
  b.block(0.7, eave + 1.25, 0.7, brick, -bw / 2 + 0.35, 0, -bd / 2 + 0.35);
  b.block(0.8, 0.08, 0.8, wall, -bw / 2 + 0.35, eave + 1.25, -bd / 2 + 0.35);
  b.hipRoof(0.84, 0.84, 0.32, 0x5d5a55, eave + 1.33, -bw / 2 + 0.35, -bd / 2 + 0.35);
  windowOn(b, 'front', -bw / 2 + 0.35, eave + 0.75, -bd / 2 + 0.7, 0.24, 0.4, trim);
  // Apron in front of the bays.
  b.block(3.0, 0.02, 0.8, CONCRETE, -0.45, 0, bd / 2 + 0.4);
  b.use('glow');
  for (const x of [-1.1, 0.25]) b.box(0.16, 0.06, 0.06, 0xffc865, x, 1.56, bd / 2 + 0.06);
  b.use('body');
  b.pop();
  // Flagpole and a bench.
  b.cylinder(0.025, 2.4, METAL, w / 2 - 0.4, 1.2, d / 2 - 0.7, undefined, 6);
  b.box(0.42, 0.26, 0.015, 0xb03a2e, w / 2 - 0.19, 2.2, d / 2 - 0.7);
  b.box(0.2, 0.13, 0.016, 0x2d3f6c, w / 2 - 0.29, 2.265, d / 2 - 0.69);
  signs.push({ text: 'STATION 7', background: '#b3271f', w: 1.7, h: 0.24, x: -0.85, y: 1.72, z: bz + bd / 2 + 0.035, rotation: 0 });
  return eave + 1.6;
}

/** A-frame cabin: roof to the ground, glazed gable, deck on stilts. */
function aframe(b: ModelBuilder, _w: number, d: number, rng: Rng): number {
  const roof = rng.pick([0x7a5a3c, 0x56704a, 0x8a3a2c, 0x6a6e70]);
  const wood = rng.pick([0x9a7448, 0x8a6844, 0xa98457]);
  const span = 2.4;
  const len = 2.4;
  const rise = 2.3;
  const bz = -0.4;
  b.push(0, 0, bz);
  b.block(span - 0.1, 0.18, len, CONCRETE, 0, 0, 0);
  // Roof planes along z (ridge along z).
  b.push(0, 0, 0, { y: Math.PI / 2 });
  b.gableRoof(len + 0.3, span + 0.2, rise, roof, 0.18, wood);
  b.pop();
  // Glazed front gable with mullions, just proud of the gable end.
  const gz = (len + 0.3) / 2 + 0.012;
  b.use('glass');
  b.tri([-span / 2 + 0.22, 0.32, gz], [span / 2 - 0.22, 0.32, gz], [0, rise - 0.12, gz], GLASS);
  b.use('body');
  for (const x of [-0.4, 0, 0.4]) {
    const h = (rise - 0.44) * (1 - Math.abs(x) / (span / 2 - 0.22));
    b.block(0.04, h, 0.04, wood, x, 0.32, gz + 0.01);
  }
  b.box(span - 0.6, 0.04, 0.04, wood, 0, 1.15, gz + 0.01);
  b.box(span - 0.4, 0.05, 0.05, wood, 0, 0.32, gz + 0.01);
  // Deck on posts.
  b.block(span + 0.3, 0.08, 0.7, WOOD, 0, 0.18, gz + 0.36);
  for (const s of [-1, 1]) {
    b.block(0.06, 0.2, 0.06, WOOD_DARK, s * (span / 2 + 0.1), 0, gz + 0.66);
    b.block(0.04, 0.36, 0.04, WOOD_DARK, s * (span / 2 + 0.1), 0.26, gz + 0.66);
  }
  b.box(span + 0.3, 0.03, 0.03, WOOD_DARK, 0, 0.6, gz + 0.68);
  chimney(b, 0.55, -0.6, rise + 0.1, STONE);
  b.pop();
  if (rng.next() < 0.6) car(b, 1.55, d / 2 - 0.8, 0, rng.pick([0x4a5a3a, 0x2f4e6e, 0x3a3a3a]), true);
  b.block(0.6, 0.28, 0.24, LOG, -1.5, 0, -0.2, { y: Math.PI / 2 });
  return rise + 0.2;
}

/** Single-wide mobile home: skirting, low roof, steps, propane tank, dish. */
function trailer(b: ModelBuilder, w: number, d: number, rng: Rng, p: Palette): number {
  const wall = rng.pick([0xe3dccb, 0xc9d1cf, 0xd8c9a0, 0xb9c4b0]);
  const stripe = rng.pick([0x7c2f27, 0x2f4a5f, 0x5b6b3a, 0x8a5a2a]);
  const bw = 4.8;
  const bd = 1.2;
  const bz = -0.2;
  const floor = 0.32;
  const eave = floor + 0.85;
  b.push(0, 0, bz);
  b.block(bw - 0.1, floor, bd - 0.06, 0x8f8a7e, 0, 0, 0);
  for (let i = 0; i < 18; i += 1) b.box(0.012, floor - 0.02, 0.02, darken(0x8f8a7e, 0.75), -bw / 2 + 0.2 + i * 0.26, floor / 2, bd / 2 - 0.02);
  b.block(bw, eave - floor, bd, wall, 0, floor, 0);
  b.box(bw + 0.01, 0.06, bd + 0.01, stripe, 0, floor + 0.55, 0);
  b.gableRoof(bw + 0.12, bd + 0.16, 0.16, 0xbfc3c0, eave, wall);
  for (const x of [-1.8, -0.9, 0.9, 1.8]) windowOn(b, 'front', x, floor + 0.48, bd / 2, 0.42, 0.3, 0xf1ebdc);
  doorOn(b, 'front', 0, bd / 2, 0.28, 0.64, 0xf1ebdc, p.accent, floor + 0.02);
  windowOn(b, 'left', -bw / 2, floor + 0.48, 0, 0.36, 0.3, 0xf1ebdc);
  // Steps and a small deck.
  b.block(0.8, floor, 0.5, WOOD, 0, 0, bd / 2 + 0.25);
  b.block(0.5, floor * 0.5, 0.22, WOOD, 0, 0, bd / 2 + 0.6);
  // Propane tank and satellite dish.
  b.cylinder(0.12, 0.5, 0xeeeeea, bw / 2 + 0.35, 0.2, -0.1, { z: Math.PI / 2 }, 10);
  b.block(0.04, 0.2, 0.04, METAL, -bw / 2 + 0.6, eave + 0.1, -0.2);
  b.sphere(0.16, 0.16, 0.06, 0xd6d6d0, -bw / 2 + 0.6, eave + 0.32, -0.12, 8);
  b.pop();
  b.block(1.2, 0.02, d / 2 - (bz + bd / 2), 0x9c8f72, 1.6, 0, (bz + bd / 2 + d / 2) / 2);
  car(b, 1.6, d / 2 - 0.9, Math.PI, rng.pick(CAR_COLORS), rng.next() < 0.6);
  if (rng.next() < 0.6) fence(b, w / 2 + 0.3, -d / 2 - 0.35, bz - 0.2, 0x9aa3a3, false);
  return eave + 0.2;
}

/** Highway gas station: canopy over pump islands, small shop behind, price sign. */
function gas(b: ModelBuilder, w: number, d: number, rng: Rng, signs: SignSpec[]): number {
  const brand = rng.pick([0xc0392b, 0x2f6a9a, 0x2e7d4f]);
  const white = 0xf0ede4;
  // Forecourt.
  b.block(w - 0.2, 0.02, d - 0.2, ASPHALT, 0, 0, 0);
  for (let i = 0; i < 4; i += 1) b.box(0.04, 0.025, 0.8, 0xd8d2bf, -1.8 + i * 1.2, 0.02, -1.2);
  // Shop at the back.
  b.block(2.6, 1.05, 1.1, white, -1.2, 0.02, -1.25);
  b.block(2.7, 0.18, 1.2, brand, -1.2, 1.07, -1.25);
  for (const x of [-1.9, -1.2]) windowOn(b, 'front', x, 0.58, -0.7, 0.5, 0.5, white);
  doorOn(b, 'front', -0.55, -0.7, 0.34, 0.68, white, 0x3a4a52, 0.02);
  b.block(0.5, 0.5, 0.3, 0x3a8acb, -2.3, 0.02, -0.55);
  // Canopy on four columns with pumps.
  const cy = 1.3;
  for (const [x, z] of [
    [-0.2, -0.1],
    [2.0, -0.1],
    [-0.2, 1.3],
    [2.0, 1.3],
  ] as const) {
    b.block(0.12, cy, 0.12, white, x, 0.02, z);
  }
  b.block(2.8, 0.2, 2.0, white, 0.9, cy, 0.6);
  b.box(2.82, 0.1, 2.02, brand, 0.9, cy + 0.12, 0.6);
  b.use('glow');
  b.box(2.5, 0.01, 1.7, 0xfff4d8, 0.9, cy - 0.005, 0.6);
  b.use('body');
  for (const x of [0.35, 1.45]) {
    b.block(0.3, 0.08, 1.2, CONCRETE, x, 0.02, 0.6);
    for (const z of [0.3, 0.9]) {
      b.block(0.2, 0.5, 0.14, white, x, 0.1, z);
      b.block(0.2, 0.1, 0.15, brand, x, 0.5, z);
      b.box(0.16, 0.1, 0.01, 0x1c2a30, x, 0.38, z + 0.075);
    }
  }
  car(b, 0.85, 0.6, 0, rng.pick(CAR_COLORS));
  // Price sign by the road.
  b.block(0.08, 1.6, 0.08, METAL, w / 2 - 0.4, 0, d / 2 - 0.4);
  b.block(0.6, 0.5, 0.08, brand, w / 2 - 0.4, 1.4, d / 2 - 0.4);
  signs.push({ text: 'FUEL', background: '#f0ede4', w: 1.0, h: 0.22, x: 0.9, y: cy + 0.1, z: 1.611, rotation: 0 });
  return cy + 0.4;
}

/** Brick schoolhouse with a bell cupola, flagpole and a play area. */
function school(b: ModelBuilder, w: number, d: number, rng: Rng, signs: SignSpec[]): number {
  const brick = rng.pick([0x9a4a38, 0xa25a40, 0x8e4b3a]);
  const trim = 0xf1ebdc;
  const roof = 0x4e4e4e;
  const bw = 4.2;
  const bd = 2.2;
  const eave = 1.35;
  const bz = -0.45;
  b.push(0, 0, bz);
  foundation(b, bw, bd, 0, 0, 0.16);
  b.block(bw, eave, bd, brick, 0, 0.16, 0);
  b.box(bw + 0.02, 0.06, bd + 0.02, trim, 0, eave + 0.1, 0);
  b.hipRoof(bw + 0.3, bd + 0.3, 0.7, roof, eave + 0.16);
  for (const x of [-1.6, -0.95, 0.95, 1.6]) windowOn(b, 'front', x, 0.8, bd / 2, 0.36, 0.62, trim);
  for (const z of [-0.5, 0.5]) {
    windowOn(b, 'left', -bw / 2, 0.8, z, 0.36, 0.62, trim);
    windowOn(b, 'right', bw / 2, 0.8, z, 0.36, 0.62, trim);
  }
  // Entrance portico.
  b.block(0.9, eave - 0.05, 0.4, brick, 0, 0.16, bd / 2 + 0.2);
  b.gableRoof(1.05, 0.62, 0.32, roof, eave + 0.1, trim, 0, bd / 2 + 0.22);
  doorOn(b, 'front', 0, bd / 2 + 0.4, 0.42, 0.7, trim, 0x2d3f5c, 0.16);
  b.block(1.0, 0.08, 0.36, CONCRETE, 0, 0, bd / 2 + 0.58);
  // Bell cupola.
  b.block(0.42, 0.4, 0.42, trim, 0, eave + 0.7, 0);
  b.block(0.3, 0.26, 0.44, DARK, 0, eave + 0.78, 0);
  b.hipRoof(0.56, 0.56, 0.36, roof, eave + 1.1);
  b.pop();
  b.cylinder(0.025, 2.3, METAL, w / 2 - 0.3, 1.15, d / 2 - 0.5, undefined, 6);
  b.box(0.42, 0.26, 0.015, 0x2d3f6c, w / 2 - 0.09, 2.1, d / 2 - 0.5);
  // Playground on the side: sandbox, slide and a climbing frame.
  b.push(-w / 2 + 0.5, 0, d / 2 - 1.0);
  b.block(0.6, 0.06, 0.6, WOOD, 0, 0, 0);
  b.block(0.5, 0.065, 0.5, 0xe2cf98, 0, 0, 0);
  b.block(0.3, 0.5, 0.3, 0xc0392b, 0.1, 0, -0.75);
  b.box(0.18, 0.03, 0.7, 0xe0b52c, 0.1, 0.28, -0.32, { x: -0.62 });
  for (const [px, pz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) b.block(0.03, 0.42, 0.03, 0x2d6a9a, -0.55 + px * 0.2, 0, -0.4 + pz * 0.2);
  b.block(0.44, 0.03, 0.44, 0x2d6a9a, -0.55, 0.42, -0.4);
  b.pop();
  signs.push({ text: 'SCHOOL', background: '#2d3f5c', w: 0.9, h: 0.22, x: 0, y: eave - 0.04, z: bz + bd / 2 + 0.41, rotation: 0 });
  return eave + 1.5;
}

/** Roadside motel: a row of rooms under a walkway roof, office, tall sign. */
function motel(b: ModelBuilder, w: number, d: number, rng: Rng, signs: SignSpec[]): number {
  const wall = rng.pick([0xe6d6b8, 0xd9c7a6, 0xc9d6cf]);
  const doorColor = rng.pick([0x2f6a5c, 0x9c3b31, 0x3d5a8a, 0xb88a2e]);
  const roof = 0x6e3f36;
  const bw = 5.2;
  const bd = 1.6;
  const eave = 1.0;
  const bz = -0.8;
  b.push(0, 0, bz);
  foundation(b, bw, bd);
  b.block(bw, eave, bd, wall, 0, 0.1, 0);
  b.gableRoof(bw + 0.2, bd + 0.9, 0.4, roof, eave + 0.1, wall, 0, 0.35);
  for (const x of [-1.9, -1.2, -0.5, 0.2, 0.9, 1.6]) {
    doorOn(b, 'front', x, bd / 2, 0.24, 0.6, 0xf1ebdc, doorColor);
    windowOn(b, 'front', x + 0.3, 0.62, bd / 2, 0.22, 0.26, 0xf1ebdc);
    b.block(0.04, eave, 0.04, 0xf1ebdc, x - 0.17, 0.1, bd / 2 + 0.7);
  }
  b.block(bw, 0.06, 0.8, CONCRETE, 0, 0, bd / 2 + 0.4);
  // Office with a big window at the end.
  b.block(0.9, eave + 0.15, 1.0, mix(wall, 0xffffff, 0.3), bw / 2 - 0.3, 0.1, 0.1);
  windowOn(b, 'front', bw / 2 - 0.3, 0.6, 0.6, 0.6, 0.5, 0xf1ebdc);
  b.pop();
  // Parking with two cars, and the tall sign.
  b.block(w - 0.2, 0.02, 1.1, ASPHALT, 0, 0, d / 2 - 0.55);
  car(b, -1.4, d / 2 - 0.6, Math.PI / 2, rng.pick(CAR_COLORS));
  car(b, 0.6, d / 2 - 0.6, -Math.PI / 2, rng.pick(CAR_COLORS), true);
  b.block(0.1, 2.1, 0.1, METAL, w / 2 - 0.35, 0, d / 2 - 0.3);
  b.block(0.12, 0.7, 0.9, 0x2d3f5c, w / 2 - 0.35, 1.7, d / 2 - 0.3);
  b.use('glow');
  b.box(0.13, 0.08, 0.7, 0xff6a4a, w / 2 - 0.35, 1.75, d / 2 - 0.3);
  b.use('body');
  signs.push({ text: 'MOTEL', background: '#2d3f5c', w: 0.8, h: 0.4, x: w / 2 - 0.28, y: 2.12, z: d / 2 - 0.3, rotation: Math.PI / 2 });
  signs.push({ text: 'MOTEL', background: '#2d3f5c', w: 0.8, h: 0.4, x: w / 2 - 0.42, y: 2.12, z: d / 2 - 0.3, rotation: -Math.PI / 2 });
  return eave + 1.1;
}

/** Metal workshop: ribbed walls, roll-up door, low gable, pickup out front. */
function shop(b: ModelBuilder, _w: number, d: number, rng: Rng): number {
  const metal = rng.pick([0x9aa3a3, 0x7f8f88, 0xa9a08a, 0x6f7f9a]);
  const roof = rng.pick([0x5c5f5a, 0x7c2f27, 0x3e5a3a]);
  const bw = 2.8;
  const bd = 2.2;
  const eave = 1.2;
  const bz = -0.45;
  b.push(0, 0, bz);
  b.block(bw + 0.04, 0.06, bd + 0.04, CONCRETE, 0, 0, 0);
  b.block(bw, eave, bd, metal, 0, 0.06, 0);
  for (let i = 0; i < 15; i += 1) {
    const x = -bw / 2 + 0.1 + i * 0.185;
    b.box(0.03, eave, 0.012, darken(metal, 0.82), x, 0.06 + eave / 2, bd / 2 + 0.006);
    b.box(0.03, eave, 0.012, darken(metal, 0.82), x, 0.06 + eave / 2, -bd / 2 - 0.006);
  }
  b.gableRoof(bw + 0.2, bd + 0.2, 0.42, roof, eave + 0.06, metal);
  b.box(1.3, 0.95, 0.03, 0xd8d2c2, -0.35, 0.54, bd / 2 + 0.02);
  for (let i = 1; i < 8; i += 1) b.box(1.28, 0.012, 0.035, 0xb0aa9a, -0.35, 0.06 + i * 0.12, bd / 2 + 0.025);
  doorOn(b, 'front', 0.85, bd / 2, 0.28, 0.6, 0xd8d2c2, 0x5a6a6a, 0.06);
  windowOn(b, 'right', bw / 2, 0.75, 0, 0.5, 0.3, 0xd8d2c2);
  b.block(0.6, 0.6, 0.4, 0x3a3e3d, -bw / 2 - 0.35, 0, -0.4);
  b.pop();
  b.block(1.6, 0.02, d / 2 - (bz + bd / 2), 0x9c8f72, -0.35, 0, (bz + bd / 2 + d / 2) / 2);
  car(b, -0.35, d / 2 - 0.55, Math.PI, rng.pick([0x7b2f2a, 0x2f4e6e, 0xb9b4a6, 0x3a3a3a]), true);
  // Oil drums.
  for (const [x, z] of [
    [1.6, 0.2],
    [1.75, -0.05],
  ] as const) {
    b.cylinder(0.1, 0.28, rng.pick([0x2f4e6e, 0x7c2f27, 0x3e5a3a]), x, 0.14, z, undefined, 8);
  }
  return eave + 0.5;
}

/** Charred slab, a blackened standing chimney or wall stub, and scattered beams. */
function rubble(b: ModelBuilder, width: number, depth: number, rng: Rng, chimneyTop: number): void {
  const w = Math.min(width - 0.6, 3.6);
  const d = Math.min(depth - 0.8, 2.6);
  b.block(w + 0.1, 0.08, d + 0.1, 0x3b3631, 0, 0, -0.3);
  b.block(w * 0.8, 0.22, d * 0.75, 0x2a2622, 0, 0.06, -0.3);
  for (let i = 0; i < 6; i += 1) {
    const x = rng.range(-w / 2, w / 2) * 0.8;
    const z = -0.3 + rng.range(-d / 2, d / 2) * 0.8;
    b.box(rng.range(0.6, 1.2), 0.07, 0.07, i % 2 ? 0x1f1c1a : 0x2e2925, x, 0.3, z, {
      x: rng.range(-0.4, 0.4),
      y: rng.range(0, Math.PI),
      z: rng.range(-0.5, 0.5),
    });
  }
  if (chimneyTop > 0) b.block(0.26, chimneyTop, 0.26, 0x4a3530, w / 2 - 0.4, 0, -0.5);
  else b.block(0.1, 0.7, 1.0, 0x262321, -w / 2 + 0.1, 0, -0.3);
}

const CHIMNEY_KINDS = new Set<BuildingKind>(['house', 'twostory', 'ranch', 'cabin', 'aframe']);

export function buildBuildingModel(kind: BuildingKind, width: number, depth: number, seed: number): BuildingModel {
  const rng = new Rng(seed ^ 0x2545f491);
  const p = palette(rng);
  const intact = new ModelBuilder();
  const signs: SignSpec[] = [];
  let height = 2;
  switch (kind) {
    case 'house':
      height = house(intact, width, depth, rng, p);
      break;
    case 'twostory':
      height = twostory(intact, width, depth, rng, p);
      break;
    case 'ranch':
      height = ranch(intact, width, depth, rng, p);
      break;
    case 'barn':
      height = barn(intact, width, depth, rng);
      break;
    case 'cabin':
      height = cabin(intact, width, depth, rng);
      break;
    case 'store':
      height = store(intact, width, depth, rng, signs);
      break;
    case 'chapel':
      height = chapel(intact, width, depth, rng);
      break;
    case 'station':
      height = station(intact, width, depth, signs);
      break;
    case 'aframe':
      height = aframe(intact, width, depth, rng);
      break;
    case 'trailer':
      height = trailer(intact, width, depth, rng, p);
      break;
    case 'gas':
      height = gas(intact, width, depth, rng, signs);
      break;
    case 'school':
      height = school(intact, width, depth, rng, signs);
      break;
    case 'motel':
      height = motel(intact, width, depth, rng, signs);
      break;
    case 'shop':
      height = shop(intact, width, depth, rng);
      break;
  }
  const debris = new ModelBuilder();
  rubble(debris, width, depth, rng, CHIMNEY_KINDS.has(kind) ? 1.2 : 0);
  // Yard: a lawn patch where the lot is a home.
  if (kind === 'house' || kind === 'twostory' || kind === 'ranch') {
    intact.block(width - 0.3, 0.012, depth - 0.3, LAWN, 0, 0, 0);
  }
  return { intact, rubble: debris, signs, height };
}
