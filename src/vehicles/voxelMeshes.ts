import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  RingGeometry,
  Shape,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { VehicleType } from './types';

/**
 * Chunky, self-aware voxel vehicle meshes. Everything is boxes (plus wheel
 * cylinders) with flat colors — readable at RTS zoom, more silhouette detail
 * than the original single-box bodies.
 *
 * Draw calls: unreferenced decorative parts are merged at build time
 * (`collapseParts`) into a few multi-material meshes per vehicle; transforms
 * are baked into cloned geometries and colors carried on a per-vertex 'color'
 * attribute while bucket materials stay authoritative.
 *
 * Named parts the rest of the game relies on (kept as separate meshes/groups):
 *  - 'wheel'        ground-vehicle wheels (one merged mesh)
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
const CHROME = 0xd7dce2;
const RUBBER = 0x24282d;
const HEADLIGHT = 0xffe7a3;
const TAILLIGHT = 0xff3b30;
const ACCENT = 0x4b5563;

// Shared material cache — every sedan body, wheel, glass band, etc. reuses one
// material instance, cutting GPU state switches and per-vehicle allocations.
// Light bar materials are intentionally NOT cached (they animate per truck).
const materialCache = new Map<string, MeshStandardMaterial>();

function std(color: number, roughness = 0.75, metalness = 0.1): MeshStandardMaterial {
  const key = `${color}|${roughness}|${metalness}`;
  let mat = materialCache.get(key);
  if (!mat) {
    mat = new MeshStandardMaterial({ color: new Color(color), roughness, metalness });
    materialCache.set(key, mat);
  }
  return mat;
}

// Shared box geometry cache — same-type vehicles reuse identical part geometry.
const geoCache = new Map<string, BufferGeometry>();

function box(w: number, h: number, d: number, mat: MeshStandardMaterial, name?: string): Mesh {
  const key = `${w.toFixed(4)}|${h.toFixed(4)}|${d.toFixed(4)}`;
  let geo = geoCache.get(key);
  if (!geo) {
    geo = new BoxGeometry(w, h, d);
    geoCache.set(key, geo);
  }
  const m = new Mesh(geo, mat);
  m.castShadow = true;
  if (name) m.name = name;
  return m;
}

/** A low-poly chamfered prism: the clipped corners keep the voxel language but
 * give cabs and body shells a more intentional, manufactured silhouette. */
function chamferedBox(
  w: number,
  h: number,
  d: number,
  mat: MeshStandardMaterial,
  name?: string,
  chamfer = 0.08,
): Mesh {
  const bevel = Math.min(chamfer, w * 0.25, h * 0.25);
  const key = `chamfer|${w.toFixed(4)}|${h.toFixed(4)}|${d.toFixed(4)}|${bevel.toFixed(4)}`;
  let geo = geoCache.get(key);
  if (!geo) {
    const shape = new Shape();
    shape.moveTo(-w / 2 + bevel, -h / 2);
    shape.lineTo(w / 2 - bevel, -h / 2);
    shape.lineTo(w / 2, -h / 2 + bevel);
    shape.lineTo(w / 2, h / 2 - bevel);
    shape.lineTo(w / 2 - bevel, h / 2);
    shape.lineTo(-w / 2 + bevel, h / 2);
    shape.lineTo(-w / 2, h / 2 - bevel);
    shape.lineTo(-w / 2, -h / 2 + bevel);
    shape.closePath();
    geo = new ExtrudeGeometry(shape, { depth: d, bevelEnabled: false, steps: 1 });
    geo.translate(0, 0, -d / 2);
    geo.computeVertexNormals();
    geoCache.set(key, geo);
  }
  const m = new Mesh(geo, mat);
  m.castShadow = true;
  if (name) m.name = name;
  return m;
}

function cylinder(
  radius: number,
  length: number,
  mat: MeshStandardMaterial,
  name?: string,
  axis: 'x' | 'y' | 'z' = 'y',
  segments = 8,
): Mesh {
  const key = `cylinder|${radius.toFixed(4)}|${length.toFixed(4)}|${axis}|${segments}`;
  let geo = geoCache.get(key);
  if (!geo) {
    geo = new CylinderGeometry(radius, radius, length, segments);
    if (axis === 'x') geo.rotateZ(Math.PI / 2);
    if (axis === 'z') geo.rotateX(Math.PI / 2);
    geoCache.set(key, geo);
  }
  const m = new Mesh(geo, mat);
  m.castShadow = true;
  if (name) m.name = name;
  return m;
}

// ── Static part merging ──────────────────────────────────────────────────────
// Decorative boxes are merged into a handful of multi-material meshes to cut
// draw calls. Named hook parts (ladder/blade/wings/…) and animatable groups
// (lightbar/mainRotor) stay untouched; see the contract list at the top of
// this file and src/vehicles/__tests__/meshes.test.ts.

/**
 * Bake the part's paint color into a per-vertex 'color' attribute so merged
 * geometry carries its color even though bucket materials stay authoritative.
 */
function bakePartColor(geo: BufferGeometry, mat: MeshStandardMaterial): void {
  const count = geo.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  const r = mat.color.r;
  const g = mat.color.g;
  const b = mat.color.b;
  for (let i = 0; i < count; i++) {
    colors[i * 3 + 0] = r;
    colors[i * 3 + 1] = g;
    colors[i * 3 + 2] = b;
  }
  geo.setAttribute('color', new BufferAttribute(colors, 3));
}

/**
 * Merge direct-child meshes of `parent` into one mesh per returned bucket
 * name. `classify` returns the bucket for parts that should be merged or null
 * to keep the part as-is. Transforms are baked into cloned geometries, parts
 * sharing a material instance fuse into a single group, and the merged mesh
 * gets a material array with geometry groups so it renders identically to the
 * original separate parts.
 */
function collapseParts(
  parent: Object3D,
  classify: (mesh: Mesh) => string | null,
): void {
  const children = parent.children.filter((c): c is Mesh => (c as Mesh).isMesh);
  type Bucket = { mats: MeshStandardMaterial[]; geos: BufferGeometry[] };
  const buckets = new Map<string, Bucket>();
  const kept = new Set<Mesh>();
  for (const m of children) {
    const bucketName = classify(m);
    if (bucketName == null) {
      kept.add(m);
      continue;
    }
    // Bake the local transform into an owned copy — cached geometries are
    // shared across vehicles and must never be mutated.
    m.updateMatrix();
    // Use one predictable attribute layout for both BoxGeometry and the
    // chamfered ExtrudeGeometry parts before merging. Extrusion is commonly
    // non-indexed while boxes are indexed; mixing them makes BufferGeometryUtils
    // reject the whole bucket and breaks the draw-call collapse.
    const cloned = m.geometry.clone();
    const geo = cloned.index ? cloned.toNonIndexed() : cloned;
    geo.applyMatrix4(m.matrix);
    bakePartColor(geo, m.material as MeshStandardMaterial);
    let bucket = buckets.get(bucketName);
    if (!bucket) {
      bucket = { mats: [], geos: [] };
      buckets.set(bucketName, bucket);
    }
    bucket.geos.push(geo);
    bucket.mats.push(m.material as MeshStandardMaterial);
  }
  if (buckets.size === 0) return;

  for (const m of children) {
    if (!kept.has(m)) parent.remove(m);
  }
  for (const [name, bucket] of buckets) {
    // Fuse consecutive same-material parts so each material becomes exactly
    // one draw call inside the merged mesh.
    const byMat = new Map<MeshStandardMaterial, BufferGeometry[]>();
    for (let i = 0; i < bucket.geos.length; i++) {
      const list = byMat.get(bucket.mats[i]);
      if (list) list.push(bucket.geos[i]);
      else byMat.set(bucket.mats[i], [bucket.geos[i]]);
    }
    const geos: BufferGeometry[] = [];
    const mats: MeshStandardMaterial[] = [];
    for (const [mat, list] of byMat) {
      geos.push(list.length > 1 ? mergeGeometries(list, false)! : list[0]);
      mats.push(mat);
    }
    const useGroups = geos.length > 1;
    const geo = useGroups ? mergeGeometries(geos, true)! : geos[0];
    const mesh = new Mesh(geo, useGroups ? mats : mats[0]);
    mesh.name = name;
    mesh.castShadow = true;
    parent.add(mesh);
  }
}

function makeYieldIndicator(scale: number): Mesh {
  const geo = new RingGeometry(scale * 0.55, scale * 0.7, 24);
  geo.rotateX(-Math.PI / 2);
  const mat = new MeshBasicMaterial({
    color: new Color(0xf7c948),
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
    depthTest: false,
    side: DoubleSide,
  });
  const ind = new Mesh(geo, mat);
  ind.position.y = scale * 0.34;
  ind.visible = false;
  ind.renderOrder = 21;
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
    const hubLength = scale * 0.045;
    const tireLength = scale * 0.12;
    const outward = x < 0 ? -1 : 1;
    const hub = cylinder(scale * r * 0.42, hubLength, std(CHROME, 0.35, 0.8), 'hub', 'x', 10);
    // Seat the hub just through the tire's outer face. Keeping a tiny overlap
    // avoids a light gap while leaving the chrome face visible from either side.
    hub.position.set(x + outward * (tireLength * 0.5 + hubLength * 0.5 - scale * 0.006), y, z);
    group.add(hub);
  }
}

function addVehicleLights(
  group: Group,
  scale: number,
  width: number,
  y: number,
  frontZ: number,
  rearZ: number,
): void {
  const headlight = std(HEADLIGHT, 0.3, 0.45);
  const taillight = std(TAILLIGHT, 0.35, 0.2);
  for (const x of [-width, width]) {
    const front = box(scale * 0.1, scale * 0.07, scale * 0.035, headlight, 'headlight');
    front.position.set(scale * x, y, frontZ);
    group.add(front);
    const rear = box(scale * 0.1, scale * 0.07, scale * 0.035, taillight, 'taillight');
    rear.position.set(scale * x, y, rearZ);
    group.add(rear);
  }
}

function addBumpers(
  group: Group,
  scale: number,
  width: number,
  y: number,
  frontZ: number,
  rearZ: number,
): void {
  const bumper = std(CHROME, 0.35, 0.8);
  for (const z of [frontZ, rearZ]) {
    const part = chamferedBox(scale * width, scale * 0.07, scale * 0.055, bumper, 'bumper', 0.02);
    part.position.set(0, y, z);
    group.add(part);
  }
}

function addWheelArches(group: Group, scale: number, x: number, wheelZs: number[], paint: MeshStandardMaterial): void {
  for (const z of wheelZs) {
    const arch = chamferedBox(scale * 0.055, scale * 0.13, scale * 0.34, paint, 'wheelArch', 0.025);
    arch.position.set(x, scale * 0.19, z);
    group.add(arch);
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

  let bodyWidth = 0.52;
  let bodyHeight = 0.22;
  let bodyLength = 1.05;
  let bodyY = 0.18;
  let cabinWidth = 0.46;
  let cabinHeight = 0.22;
  let cabinLength = 0.5;
  let cabinY = 0.39;
  let cabinZ = -0.05;
  let wheelZ = 0.32;
  let wheelR = 0.15;
  let wheelX = 0.28;

  if (style === 'hatchback') {
    bodyWidth = 0.5; bodyLength = 0.88; cabinHeight = 0.24; cabinLength = 0.56;
    cabinY = 0.4; cabinZ = -0.1; wheelZ = 0.27; wheelX = 0.27;
  } else if (style === 'pickup') {
    bodyWidth = 0.54; bodyLength = 1.1; bodyY = 0.2; cabinWidth = 0.5;
    cabinHeight = 0.27; cabinLength = 0.42; cabinY = 0.43; cabinZ = 0.18;
    wheelZ = 0.34; wheelR = 0.17; wheelX = 0.3;
  } else if (style === 'van') {
    bodyWidth = 0.56; bodyHeight = 0.45; bodyLength = 1.1; bodyY = 0.33;
    cabinWidth = 0.5; cabinHeight = 0.3; cabinLength = 0.68; cabinY = 0.48; cabinZ = -0.03;
    wheelZ = 0.36; wheelX = 0.3;
  }

  const body = chamferedBox(s * bodyWidth, s * bodyHeight, s * bodyLength, paint, 'body', s * 0.07);
  body.position.y = s * bodyY;
  group.add(body);
  const cabin = chamferedBox(s * cabinWidth, s * cabinHeight, s * cabinLength, paint, 'cabin', s * 0.06);
  cabin.position.set(0, s * cabinY, s * cabinZ);
  group.add(cabin);

  const glassDepth = style === 'van' ? 0.035 : 0.028;
  const glassHeight = style === 'van' ? 0.17 : 0.12;
  const glassY = style === 'van' ? 0.5 : cabinY + 0.015;
  const frontWindow = chamferedBox(s * (cabinWidth * 0.78), s * glassHeight, s * glassDepth, glass, 'windows', 0.025);
  frontWindow.position.set(0, s * glassY, s * (cabinZ + cabinLength / 2 + 0.006));
  group.add(frontWindow);
  const rearWindow = chamferedBox(s * (cabinWidth * 0.78), s * glassHeight, s * glassDepth, glass, 'windows', 0.025);
  rearWindow.position.set(0, s * glassY, s * (cabinZ - cabinLength / 2 - 0.006));
  group.add(rearWindow);
  for (const x of [-cabinWidth / 2 - 0.006, cabinWidth / 2 + 0.006]) {
    const sideWindow = chamferedBox(s * glassDepth, s * glassHeight, s * (cabinLength * 0.62), glass, 'windows', 0.02);
    sideWindow.position.set(s * x, s * glassY, s * cabinZ);
    group.add(sideWindow);
  }

  const grille = box(s * bodyWidth * 0.55, s * 0.09, s * 0.025, std(ACCENT, 0.8, 0.15), 'grille');
  grille.position.set(0, s * (bodyY + 0.01), s * (bodyLength / 2 + 0.012));
  group.add(grille);
  if (style === 'pickup') {
    const bed = chamferedBox(s * 0.5, s * 0.12, s * 0.5, std(0x2b2b2b, 0.9, 0.05), 'bed', 0.02);
    bed.position.set(0, s * 0.34, -s * 0.28);
    group.add(bed);
  }
  addVehicleLights(group, s, bodyWidth * 0.34, s * (bodyY + 0.035), s * (bodyLength / 2 + 0.035), -s * (bodyLength / 2 + 0.035));
  addBumpers(group, s, bodyWidth * 0.9, s * (bodyY - 0.025), s * (bodyLength / 2 + 0.04), -s * (bodyLength / 2 + 0.04));
  addWheelArches(group, s, -s * (bodyWidth / 2 - 0.005), [s * wheelZ, -s * wheelZ], paint);
  addWheelArches(group, s, s * (bodyWidth / 2 - 0.005), [s * wheelZ, -s * wheelZ], paint);
  addWheels(group, s, [
    [s * wheelX, s * 0.1, s * wheelZ], [-s * wheelX, s * 0.1, s * wheelZ],
    [s * wheelX, s * 0.1, -s * wheelZ], [-s * wheelX, s * 0.1, -s * wheelZ],
  ], wheelR);

  // Merge decorative panels into one body mesh (paint/glass/dark become
  // material groups) and the four tires into a single 'wheel' mesh.
  const civilianBody = new Set(['body', 'cabin', 'windows', 'bed', 'wheelArch', 'headlight', 'taillight', 'bumper', 'grille']);
  collapseParts(group, (m) => {
    if (m.name === 'wheel' || m.name === 'hub') return 'wheel';
    if (civilianBody.has(m.name)) return 'body';
    return null;
  });
}

// ── Service vehicles ─────────────────────────────────────────────────────────

function buildFiretruck(group: Group, scale: number) {
  const s = scale;
  const red = std(0xcc1111, 0.5, 0.2);
  const darkRed = std(0x7d1118, 0.65, 0.2);
  const glass = std(DARK_GLASS, 0.25, 0.4);
  const silver = std(STEEL, 0.4, 0.7);
  const black = std(RUBBER, 0.9, 0.05);

  const chassis = chamferedBox(s * 0.85, s * 0.3, s * 1.7, red, 'body', s * 0.06);
  chassis.position.y = s * 0.28;
  group.add(chassis);
  // Crew cab up front
  const cab = chamferedBox(s * 0.8, s * 0.45, s * 0.5, red, 'cab', s * 0.06);
  cab.position.set(0, s * 0.6, s * 0.55);
  group.add(cab);
  const windshield = chamferedBox(s * 0.64, s * 0.18, s * 0.045, glass, 'windows', s * 0.02);
  windshield.position.set(0, s * 0.68, s * 0.81);
  group.add(windshield);
  for (const x of [-s * 0.405, s * 0.405]) {
    const sideWindow = chamferedBox(s * 0.04, s * 0.18, s * 0.3, glass, 'windows', s * 0.015);
    sideWindow.position.set(x, s * 0.68, s * 0.55);
    group.add(sideWindow);
  }
  // Equipment body with white stripe
  const bodyBack = chamferedBox(s * 0.8, s * 0.5, s * 1.0, red, 'equipment', s * 0.045);
  bodyBack.position.set(0, s * 0.62, -s * 0.3);
  group.add(bodyBack);
  const stripe = box(s * 0.82, s * 0.1, s * 1.0, std(0xf5f5f4, 0.6, 0.1), 'stripe');
  stripe.position.set(0, s * 0.52, -s * 0.3);
  group.add(stripe);
  // Side compartments, latches, and a hose reel make the rescue role legible
  // even when the truck is viewed from a high RTS camera.
  for (const x of [-s * 0.415, s * 0.415]) {
    for (const z of [-s * 0.56, -s * 0.22, s * 0.08]) {
      const compartment = chamferedBox(s * 0.035, s * 0.22, s * 0.24, darkRed, 'compartment', s * 0.012);
      compartment.position.set(x, s * 0.66, z);
      group.add(compartment);
      const latch = box(s * 0.025, s * 0.035, s * 0.035, silver, 'latch');
      latch.position.set(x + (x < 0 ? -s * 0.02 : s * 0.02), s * 0.65, z);
      group.add(latch);
    }
  }
  const reel = cylinder(s * 0.12, s * 0.07, silver, 'reel', 'x', 12);
  reel.position.set(s * 0.45, s * 0.84, -s * 0.27);
  group.add(reel);
  const hose = cylinder(s * 0.075, s * 0.085, black, 'hose', 'x', 12);
  hose.position.set(s * 0.48, s * 0.84, -s * 0.27);
  group.add(hose);
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
  collapseParts(ladder, () => 'rails');
  addLightbar(group, s, s * 0.88, s * 0.55);
  const grille = box(s * 0.48, s * 0.12, s * 0.035, std(ACCENT, 0.8, 0.15), 'grille');
  grille.position.set(0, s * 0.34, s * 0.865);
  group.add(grille);
  addVehicleLights(group, s, 0.28, s * 0.37, s * 0.87, -s * 0.87);
  addBumpers(group, s, 0.78, s * 0.24, s * 0.89, -s * 0.88);
  addWheels(group, s, [
    [s * 0.45, s * 0.16, s * 0.55], [-s * 0.45, s * 0.16, s * 0.55],
    [s * 0.45, s * 0.16, -s * 0.1], [-s * 0.45, s * 0.16, -s * 0.1],
    [s * 0.45, s * 0.16, -s * 0.6], [-s * 0.45, s * 0.16, -s * 0.6],
  ], 0.18);

  const firetruckBody = new Set([
    'body', 'cab', 'windows', 'equipment', 'stripe', 'bumper', 'compartment', 'latch',
    'reel', 'hose', 'grille', 'headlight', 'taillight',
  ]);
  collapseParts(group, (m) => {
    if (m.name === 'wheel' || m.name === 'hub') return 'wheel';
    if (firetruckBody.has(m.name)) return 'body';
    return null;
  });
}

function buildBulldozer(group: Group, scale: number) {
  const s = scale;
  const yellow = std(0xf2b50a, 0.7, 0.2);
  const dark = std(0x2b2b2b, 0.9, 0.1);
  const glass = std(DARK_GLASS, 0.3, 0.3);
  const steel = std(STEEL, 0.45, 0.75);

  const body = chamferedBox(s * 0.62, s * 0.32, s * 0.85, yellow, 'body', s * 0.05);
  body.position.y = s * 0.36;
  group.add(body);
  // Tracks
  for (const side of [-1, 1]) {
    const track = chamferedBox(s * 0.22, s * 0.3, s * 1.0, dark, 'track', s * 0.035);
    track.position.set(side * s * 0.42, s * 0.18, 0);
    group.add(track);
    for (const z of [-0.34, -0.11, 0.12, 0.35]) {
      const tread = box(s * 0.24, s * 0.035, s * 0.07, steel, 'tread');
      tread.position.set(side * s * 0.42, s * 0.18, s * z);
      group.add(tread);
    }
    for (const z of [-0.3, 0.3]) {
      const roller = cylinder(s * 0.075, s * 0.055, steel, 'roller', 'x', 10);
      roller.position.set(side * s * 0.42, s * 0.18, s * z);
      group.add(roller);
    }
  }
  // Cab with window band
  const cab = chamferedBox(s * 0.45, s * 0.4, s * 0.45, yellow, 'cab', s * 0.05);
  cab.position.set(0, s * 0.72, -s * 0.1);
  group.add(cab);
  const frontWindow = chamferedBox(s * 0.3, s * 0.2, s * 0.035, glass, 'windows', s * 0.02);
  frontWindow.position.set(0, s * 0.78, s * 0.135);
  group.add(frontWindow);
  for (const x of [-s * 0.23, s * 0.23]) {
    const sideWindow = chamferedBox(s * 0.035, s * 0.2, s * 0.3, glass, 'windows', s * 0.02);
    sideWindow.position.set(x, s * 0.78, -s * 0.1);
    group.add(sideWindow);
  }
  // Blade with lift arms
  const blade = chamferedBox(s * 0.95, s * 0.4, s * 0.1, std(0x8a8f96, 0.5, 0.7), 'blade', s * 0.035);
  blade.position.set(0, s * 0.3, s * 0.62);
  group.add(blade);
  for (const side of [-1, 1]) {
    const arm = cylinder(s * 0.035, s * 0.5, steel, 'arm', 'z', 8);
    arm.position.set(side * s * 0.36, s * 0.34, s * 0.36);
    group.add(arm);
  }
  // Exhaust stack
  const stack = cylinder(s * 0.06, s * 0.3, dark, 'exhaust', 'y', 8);
  stack.position.set(s * 0.15, s * 0.66, s * 0.25);
  group.add(stack);
  const stackCap = cylinder(s * 0.075, s * 0.035, dark, 'exhaustCap', 'y', 8);
  stackCap.position.set(s * 0.15, s * 0.82, s * 0.25);
  group.add(stackCap);
  addVehicleLights(group, s, 0.22, s * 0.38, s * 0.45, -s * 0.45);
  const grille = box(s * 0.35, s * 0.08, s * 0.03, std(ACCENT, 0.8, 0.15), 'grille');
  grille.position.set(0, s * 0.4, s * 0.44);
  group.add(grille);

  // Merge everything except the named 'blade' hook.
  const dozerBody = new Set([
    'body', 'cab', 'windows', 'track', 'tread', 'roller', 'arm', 'exhaust', 'exhaustCap',
    'headlight', 'taillight', 'grille',
  ]);
  collapseParts(group, (m) => (dozerBody.has(m.name) ? 'body' : null));
}

function buildHelicopter(group: Group, scale: number) {
  const s = scale;
  const paint = std(0xd03a1e, 0.5, 0.3);
  const dark = std(0x23272e, 0.6, 0.4);
  const glass = std(DARK_GLASS, 0.2, 0.5);
  const tankBlue = std(0x3f5a78, 0.5, 0.4);

  const body = chamferedBox(s * 0.5, s * 0.45, s * 0.95, paint, 'body', s * 0.07);
  body.position.y = s * 0.55;
  group.add(body);
  const nose = chamferedBox(s * 0.4, s * 0.3, s * 0.25, glass, 'nose', s * 0.05);
  nose.position.set(0, s * 0.55, s * 0.56);
  group.add(nose);
  for (const x of [-s * 0.255, s * 0.255]) {
    const doorWindow = chamferedBox(s * 0.035, s * 0.18, s * 0.36, glass, 'doorWindow', s * 0.02);
    doorWindow.position.set(x, s * 0.58, s * 0.06);
    group.add(doorWindow);
    const doorHandle = box(s * 0.03, s * 0.025, s * 0.09, std(CHROME, 0.35, 0.8), 'doorHandle');
    doorHandle.position.set(x + (x < 0 ? -s * 0.02 : s * 0.02), s * 0.47, s * 0.08);
    group.add(doorHandle);
  }
  // Belly tank (water payload)
  const tank = chamferedBox(s * 0.34, s * 0.16, s * 0.6, tankBlue, 'tank', s * 0.035);
  tank.position.set(0, s * 0.3, 0);
  group.add(tank);
  for (const z of [-s * 0.2, s * 0.2]) {
    const strap = box(s * 0.37, s * 0.025, s * 0.035, std(STEEL, 0.4, 0.7), 'tankStrap');
    strap.position.set(0, s * 0.3, z);
    group.add(strap);
  }
  // Tail boom + fin + tail rotor
  const boom = chamferedBox(s * 0.14, s * 0.14, s * 0.85, paint, 'tailBoom', s * 0.025);
  boom.position.set(0, s * 0.62, -s * 0.85);
  group.add(boom);
  const fin = chamferedBox(s * 0.06, s * 0.3, s * 0.18, paint, 'tailFinH', s * 0.02);
  fin.position.set(0, s * 0.78, -s * 1.22);
  group.add(fin);
  const tailRotor = box(s * 0.04, s * 0.4, s * 0.08, dark, 'tailRotor');
  tailRotor.position.set(s * 0.06, s * 0.78, -s * 1.22);
  group.add(tailRotor);
  const tailRotorBar = box(s * 0.28, s * 0.035, s * 0.04, dark, 'tailRotorBar');
  tailRotorBar.position.set(s * 0.06, s * 0.78, -s * 1.22);
  group.add(tailRotorBar);
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
  // Blades spin together — merge them into one mesh inside the spun group.
  collapseParts(rotor, () => 'rotor');
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

  const heliBody = new Set(['body', 'nose', 'doorWindow', 'doorHandle', 'tank', 'tankStrap', 'tailBoom', 'tailFinH']);
  const heliUndercarriage = new Set(['skid', 'strut', 'tailRotor', 'tailRotorBar']);
  collapseParts(group, (m) => {
    if (heliBody.has(m.name)) return 'body';
    if (heliUndercarriage.has(m.name)) return 'skid';
    return null;
  });
}

function buildAirplane(group: Group, scale: number) {
  const s = scale;
  const white = std(0xf0f0ec, 0.45, 0.4);
  const red = std(0xd02020, 0.5, 0.4);
  const dark = std(0x23272e, 0.6, 0.4);
  const glass = std(DARK_GLASS, 0.2, 0.5);
  const steel = std(STEEL, 0.4, 0.7);

  const fuselage = chamferedBox(s * 0.42, s * 0.42, s * 1.7, white, 'body', s * 0.06);
  fuselage.position.y = s * 0.5;
  group.add(fuselage);
  const nose = chamferedBox(s * 0.34, s * 0.32, s * 0.3, glass, 'nose', s * 0.05);
  nose.position.set(0, s * 0.48, s * 0.95);
  group.add(nose);
  for (const z of [s * 0.48, s * 0.12, -s * 0.24]) {
    const sideWindow = chamferedBox(s * 0.035, s * 0.1, s * 0.16, glass, 'window', s * 0.015);
    sideWindow.position.set(s * 0.22, s * 0.54, z);
    group.add(sideWindow);
  }
  // Retardant belly
  const belly = chamferedBox(s * 0.36, s * 0.16, s * 1.0, red, 'retardantTank', s * 0.035);
  belly.position.set(0, s * 0.26, 0);
  group.add(belly);
  for (const z of [-s * 0.3, s * 0.3]) {
    const tankBand = box(s * 0.38, s * 0.025, s * 0.035, steel, 'tankBand');
    tankBand.position.set(0, s * 0.27, z);
    group.add(tankBand);
  }
  // High wing + engine nacelles
  const wings = chamferedBox(s * 2.4, s * 0.07, s * 0.42, white, 'wings', s * 0.025);
  wings.position.set(0, s * 0.74, s * 0.15);
  group.add(wings);
  for (const side of [-1, 1]) {
    const nacelle = chamferedBox(s * 0.16, s * 0.16, s * 0.4, red, 'engine', s * 0.025);
    nacelle.position.set(side * s * 0.7, s * 0.66, s * 0.25);
    group.add(nacelle);
    const prop = box(s * 0.04, s * 0.4, s * 0.04, dark, 'prop');
    prop.position.set(side * s * 0.7, s * 0.66, s * 0.47);
    group.add(prop);
    const propCross = box(s * 0.28, s * 0.035, s * 0.035, dark, 'prop');
    propCross.position.set(side * s * 0.7, s * 0.66, s * 0.47);
    group.add(propCross);
    const intake = cylinder(s * 0.06, s * 0.035, steel, 'intake', 'z', 10);
    intake.position.set(side * s * 0.7, s * 0.66, s * 0.47);
    group.add(intake);
  }
  const wingLightL = box(s * 0.08, s * 0.04, s * 0.04, std(0x36d399, 0.3, 0.2), 'navLight');
  wingLightL.position.set(-s * 1.18, s * 0.76, s * 0.15);
  group.add(wingLightL);
  const wingLightR = box(s * 0.08, s * 0.04, s * 0.04, std(TAILLIGHT, 0.35, 0.2), 'navLight');
  wingLightR.position.set(s * 1.18, s * 0.76, s * 0.15);
  group.add(wingLightR);
  // Tail
  const tailPlane = chamferedBox(s * 0.9, s * 0.06, s * 0.3, white, 'tailPlane', s * 0.02);
  tailPlane.position.set(0, s * 0.62, -s * 0.78);
  group.add(tailPlane);
  const fin = chamferedBox(s * 0.06, s * 0.5, s * 0.35, red, 'tailFin', s * 0.025);
  fin.position.set(0, s * 0.85, -s * 0.78);
  group.add(fin);
  const tailStripe = box(s * 0.42, s * 0.035, s * 0.04, red, 'tailStripe');
  tailStripe.position.set(0, s * 0.72, -s * 0.78);
  group.add(tailStripe);

  // Merge everything except the named 'wings'/'tailFin' hooks.
  const planeBody = new Set([
    'body', 'nose', 'window', 'retardantTank', 'tankBand', 'engine', 'prop', 'intake',
    'navLight', 'tailPlane', 'tailStripe',
  ]);
  collapseParts(group, (m) => (planeBody.has(m.name) ? 'body' : null));
}

function buildFirefighter(group: Group, scale: number) {
  const s = scale;
  const jacket = std(0xd9a514, 0.85, 0);
  const pants = std(0x3f4754, 0.9, 0);
  const skin = std(0xe0b080, 0.8, 0);
  const reflective = std(0xfff3b0, 0.35, 0.15);
  const boot = std(0x1b1f24, 0.95, 0.05);

  for (const side of [-1, 1]) {
    const leg = box(s * 0.09, s * 0.22, s * 0.1, pants, 'leg');
    leg.position.set(side * s * 0.06, s * 0.11, 0);
    group.add(leg);
    const bootPart = chamferedBox(s * 0.1, s * 0.07, s * 0.12, boot, 'boot', s * 0.015);
    bootPart.position.set(side * s * 0.06, s * 0.025, s * 0.015);
    group.add(bootPart);
    const legStripe = box(s * 0.095, s * 0.025, s * 0.105, reflective, 'reflective');
    legStripe.position.set(side * s * 0.06, s * 0.13, s * 0.002);
    group.add(legStripe);
  }
  const torso = chamferedBox(s * 0.26, s * 0.26, s * 0.16, jacket, 'body', s * 0.025);
  torso.position.y = s * 0.35;
  group.add(torso);
  const torsoStripe = box(s * 0.27, s * 0.035, s * 0.17, reflective, 'reflective');
  torsoStripe.position.set(0, s * 0.35, s * 0.084);
  group.add(torsoStripe);
  for (const side of [-1, 1]) {
    const arm = chamferedBox(s * 0.07, s * 0.24, s * 0.09, jacket, 'arm', s * 0.015);
    arm.position.set(side * s * 0.17, s * 0.36, 0);
    group.add(arm);
    const glove = box(s * 0.075, s * 0.06, s * 0.095, boot, 'glove');
    glove.position.set(side * s * 0.17, s * 0.25, 0);
    group.add(glove);
  }
  const tank = cylinder(s * 0.07, s * 0.2, std(0x9a3a3a, 0.6, 0.3), 'airTank', 'y', 8);
  tank.position.set(0, s * 0.36, -s * 0.13);
  group.add(tank);
  const head = chamferedBox(s * 0.14, s * 0.13, s * 0.13, skin, 'head', s * 0.02);
  head.position.y = s * 0.56;
  group.add(head);
  const helmet = chamferedBox(s * 0.2, s * 0.07, s * 0.2, std(0xffdd00, 0.5, 0.1), 'helmet', s * 0.025);
  helmet.position.y = s * 0.65;
  group.add(helmet);
  const hose = cylinder(s * 0.025, s * 0.2, boot, 'hose', 'z', 8);
  hose.position.set(s * 0.12, s * 0.35, s * 0.1);
  group.add(hose);

  // Merge everything except the named 'helmet' hook.
  const firefighterBody = new Set(['leg', 'boot', 'reflective', 'body', 'arm', 'glove', 'airTank', 'head', 'hose']);
  collapseParts(group, (m) => (firefighterBody.has(m.name) ? 'body' : null));
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
  group.traverse((child) => {
    if ((child as Mesh).isMesh) child.renderOrder = 20;
  });
  const yieldInd = makeYieldIndicator(scale);
  group.add(yieldInd);
  group.userData.yieldIndicator = yieldInd as Object3D;
  return group;
}
