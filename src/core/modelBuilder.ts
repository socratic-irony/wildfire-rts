import {
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Euler,
  Float32BufferAttribute,
  Matrix4,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three';

/**
 * Merges many small coloured parts into one flat-shaded, vertex-coloured
 * geometry per layer. A vehicle or building built this way is one or two
 * draw calls instead of dozens, which is most of what the GPU and the
 * driver were spending per frame. Parts are placed with an optional
 * transform stack so sub-assemblies (a wheel, a window) can be reused.
 */
export type PartLayer = 'body' | 'glass' | 'glow';

const tmpColor = new Color();
const tmpMatrix = new Matrix4();
const tmpPosition = new Vector3();
const tmpQuaternion = new Quaternion();
const tmpEuler = new Euler();
const tmpScale = new Vector3(1, 1, 1);
const a = new Vector3();
const b = new Vector3();
const c = new Vector3();
const ab = new Vector3();
const cb = new Vector3();

/** Unit primitives, shared: parts are scaled copies of these. */
const UNIT_BOX = new BoxGeometry(1, 1, 1).toNonIndexed();
const cylinderCache = new Map<string, BufferGeometry>();
const coneCache = new Map<number, BufferGeometry>();
const sphereCache = new Map<string, BufferGeometry>();

function unitCylinder(segments: number, topRatio: number): BufferGeometry {
  const key = `${segments}:${topRatio.toFixed(3)}`;
  let geometry = cylinderCache.get(key);
  if (!geometry) {
    geometry = new CylinderGeometry(0.5 * topRatio, 0.5, 1, segments).toNonIndexed();
    cylinderCache.set(key, geometry);
  }
  return geometry;
}

function unitCone(segments: number): BufferGeometry {
  let geometry = coneCache.get(segments);
  if (!geometry) {
    geometry = new ConeGeometry(0.5, 1, segments).toNonIndexed();
    coneCache.set(segments, geometry);
  }
  return geometry;
}

function unitSphere(width: number, height: number, half: boolean): BufferGeometry {
  const key = `${width}:${height}:${half}`;
  let geometry = sphereCache.get(key);
  if (!geometry) {
    geometry = new SphereGeometry(0.5, width, height, 0, Math.PI * 2, 0, half ? Math.PI / 2 : Math.PI).toNonIndexed();
    sphereCache.set(key, geometry);
  }
  return geometry;
}

export interface Rotation {
  x?: number;
  y?: number;
  z?: number;
}

/** One cross-section of a lofted hull: an (optionally chamfered) rectangle at `z`. */
export interface LoftSection {
  z: number;
  /** Full width and height of the section. */
  w: number;
  h: number;
  /** Section centre height. */
  y: number;
  /** Corner chamfer as a fraction of the half size (0 = box, 0.4 = octagon-ish). */
  bevel?: number;
  /** Colour of the band from this section to the next. */
  color?: number;
}

class LayerBuffers {
  readonly positions: number[] = [];
  readonly colors: number[] = [];
}

export class ModelBuilder {
  private readonly layers = new Map<PartLayer, LayerBuffers>();
  private readonly stack: Matrix4[] = [];
  private current = new Matrix4();
  private layer: PartLayer = 'body';

  /** Start drawing into another layer (separate material in the final model). */
  use(layer: PartLayer): this {
    this.layer = layer;
    return this;
  }

  /** Push a transform; parts added until `pop()` are placed through it. */
  push(x = 0, y = 0, z = 0, rotation: Rotation = {}, scale = 1): this {
    this.stack.push(this.current.clone());
    tmpEuler.set(rotation.x ?? 0, rotation.y ?? 0, rotation.z ?? 0, 'YXZ');
    tmpQuaternion.setFromEuler(tmpEuler);
    tmpPosition.set(x, y, z);
    tmpScale.set(scale, scale, scale);
    tmpMatrix.compose(tmpPosition, tmpQuaternion, tmpScale);
    this.current = this.current.clone().multiply(tmpMatrix);
    return this;
  }

  pop(): this {
    this.current = this.stack.pop() ?? new Matrix4();
    return this;
  }

  /** Axis-aligned box centred at (x, y, z) before the part rotation. */
  box(w: number, h: number, d: number, color: number, x = 0, y = 0, z = 0, rotation?: Rotation): this {
    return this.addScaled(UNIT_BOX, color, x, y, z, w, h, d, rotation);
  }

  /** Box whose bottom sits at `y` (handy for walls and stacks). */
  block(w: number, h: number, d: number, color: number, x = 0, y = 0, z = 0, rotation?: Rotation): this {
    return this.box(w, h, d, color, x, y + h / 2, z, rotation);
  }

  /** Vertical cylinder (axis y). `topRatio` < 1 tapers it. Rotate for wheels and tubes. */
  cylinder(
    radius: number,
    height: number,
    color: number,
    x = 0,
    y = 0,
    z = 0,
    rotation?: Rotation,
    segments = 8,
    topRatio = 1,
  ): this {
    return this.addScaled(unitCylinder(segments, topRatio), color, x, y, z, radius * 2, height, radius * 2, rotation);
  }

  /** Wheel: cylinder on the x axis. */
  wheel(radius: number, width: number, tire: number, hub: number, x: number, y: number, z: number, segments = 10): this {
    this.cylinder(radius, width, tire, x, y, z, { z: Math.PI / 2 }, segments);
    const side = Math.sign(x) || 1;
    return this.cylinder(radius * 0.55, 0.02, hub, x + side * (width / 2 + 0.005), y, z, { z: Math.PI / 2 }, segments);
  }

  cone(radius: number, height: number, color: number, x = 0, y = 0, z = 0, rotation?: Rotation, segments = 8): this {
    return this.addScaled(unitCone(segments), color, x, y, z, radius * 2, height, radius * 2, rotation);
  }

  sphere(rx: number, ry: number, rz: number, color: number, x = 0, y = 0, z = 0, segments = 8, half = false): this {
    return this.addScaled(unitSphere(segments, Math.max(3, Math.round(segments / 2)), half), color, x, y, z, rx * 2, ry * 2, rz * 2);
  }

  /** Raw triangle (three points) in the current frame. */
  tri(p1: readonly number[], p2: readonly number[], p3: readonly number[], color: number): this {
    const buffers = this.buffers();
    tmpColor.setHex(color);
    for (const p of [p1, p2, p3]) {
      tmpPosition.set(p[0] ?? 0, p[1] ?? 0, p[2] ?? 0).applyMatrix4(this.current);
      buffers.positions.push(tmpPosition.x, tmpPosition.y, tmpPosition.z);
      buffers.colors.push(tmpColor.r, tmpColor.g, tmpColor.b);
    }
    return this;
  }

  /** Quad from four points in order (two triangles). */
  quad(p1: readonly number[], p2: readonly number[], p3: readonly number[], p4: readonly number[], color: number): this {
    return this.tri(p1, p2, p3, color).tri(p1, p3, p4, color);
  }

  /**
   * Gable (ridge along x) or hip roof. `overhang` is already included in
   * width/depth; the eave sits at `y`.
   */
  gableRoof(width: number, depth: number, rise: number, color: number, y: number, gableColor = color, x = 0, z = 0): this {
    const hw = width / 2;
    const hd = depth / 2;
    const top = y + rise;
    this.quad([x - hw, y, z + hd], [x + hw, y, z + hd], [x + hw, top, z], [x - hw, top, z], color);
    this.quad([x + hw, y, z - hd], [x - hw, y, z - hd], [x - hw, top, z], [x + hw, top, z], color);
    this.tri([x - hw, y, z - hd], [x - hw, y, z + hd], [x - hw, top, z], gableColor);
    this.tri([x + hw, y, z + hd], [x + hw, y, z - hd], [x + hw, top, z], gableColor);
    // Soffit so the overhang reads from below.
    return this.quad([x - hw, y, z - hd], [x + hw, y, z - hd], [x + hw, y, z + hd], [x - hw, y, z + hd], darken(color, 0.55));
  }

  hipRoof(width: number, depth: number, rise: number, color: number, y: number, x = 0, z = 0): this {
    const hw = width / 2;
    const hd = depth / 2;
    const ridge = Math.max(0.02, hw - hd);
    const top = y + rise;
    const fl = [x - hw, y, z + hd];
    const fr = [x + hw, y, z + hd];
    const bl = [x - hw, y, z - hd];
    const br = [x + hw, y, z - hd];
    const rl = [x - ridge, top, z];
    const rr = [x + ridge, top, z];
    this.quad(fl, fr, rr, rl, color);
    this.quad(br, bl, rl, rr, color);
    this.tri(bl, fl, rl, darken(color, 0.92));
    this.tri(fr, br, rr, darken(color, 0.92));
    return this.quad(bl, br, fr, fl, darken(color, 0.55));
  }

  /** Gambrel (barn) roof: steep lower slopes, shallow upper slopes, ridge along x. */
  gambrelRoof(width: number, depth: number, rise: number, color: number, y: number, gableColor: number): this {
    const hw = width / 2;
    const hd = depth / 2;
    const kneeY = y + rise * 0.58;
    const kneeZ = hd * 0.52;
    const top = y + rise;
    for (const side of [1, -1]) {
      const s = side;
      const p1 = [-hw * s, y, hd * s];
      const p2 = [hw * s, y, hd * s];
      const p3 = [hw * s, kneeY, kneeZ * s];
      const p4 = [-hw * s, kneeY, kneeZ * s];
      this.quad(p1, p2, p3, p4, color);
      this.quad(p4, p3, [hw * s, top, 0], [-hw * s, top, 0], darken(color, 1.06));
    }
    for (const sx of [-1, 1]) {
      const xx = sx * hw;
      const pts = [
        [xx, y, -hd],
        [xx, kneeY, -kneeZ],
        [xx, top, 0],
        [xx, kneeY, kneeZ],
        [xx, y, hd],
      ];
      for (let i = 1; i < pts.length - 1; i += 1) {
        if (sx > 0) this.tri(pts[0]!, pts[i]!, pts[i + 1]!, gableColor);
        else this.tri(pts[0]!, pts[i + 1]!, pts[i]!, gableColor);
      }
    }
    return this;
  }

  /**
   * Hull lofted through cross-sections along z (fuselages, tanks, hoods).
   * Sections are chamfered rectangles; ends are capped.
   */
  loft(sections: ReadonlyArray<LoftSection>, color: number, capColor = color): this {
    const rings = sections.map((section) => ringPoints(section));
    for (let i = 0; i < rings.length - 1; i += 1) {
      const ringA = rings[i]!;
      const ringB = rings[i + 1]!;
      const bandColor = sections[i]!.color ?? color;
      for (let k = 0; k < ringA.length; k += 1) {
        const next = (k + 1) % ringA.length;
        this.quad(ringA[k]!, ringA[next]!, ringB[next]!, ringB[k]!, bandColor);
      }
    }
    const first = rings[0]!;
    const last = rings[rings.length - 1]!;
    const firstCenter = [0, sections[0]!.y, sections[0]!.z];
    const lastCenter = [0, sections[sections.length - 1]!.y, sections[sections.length - 1]!.z];
    for (let k = 0; k < first.length; k += 1) {
      const next = (k + 1) % first.length;
      this.tri(firstCenter, first[next]!, first[k]!, capColor);
      this.tri(lastCenter, last[k]!, last[next]!, capColor);
    }
    return this;
  }

  /** Thin flat panel facing +z (decals, signs, stripes) in the current frame. */
  panel(w: number, h: number, color: number, x: number, y: number, z: number, rotation?: Rotation): this {
    return this.box(w, h, 0.01, color, x, y, z, rotation);
  }

  /** Copy another geometry in (already in local units), coloured flat. */
  geometry(source: BufferGeometry, color: number, x = 0, y = 0, z = 0, rotation?: Rotation, scale = 1): this {
    const geometry = source.index ? source.toNonIndexed() : source;
    return this.addScaled(geometry, color, x, y, z, scale, scale, scale, rotation);
  }

  get isEmpty(): boolean {
    for (const buffers of this.layers.values()) if (buffers.positions.length > 0) return false;
    return true;
  }

  /** Build one geometry per non-empty layer, with flat normals and vertex colours. */
  build(): Map<PartLayer, BufferGeometry> {
    const result = new Map<PartLayer, BufferGeometry>();
    for (const [layer, buffers] of this.layers) {
      if (buffers.positions.length === 0) continue;
      const positions = new Float32Array(buffers.positions);
      const normals = new Float32Array(positions.length);
      for (let i = 0; i < positions.length; i += 9) {
        a.set(positions[i]!, positions[i + 1]!, positions[i + 2]!);
        b.set(positions[i + 3]!, positions[i + 4]!, positions[i + 5]!);
        c.set(positions[i + 6]!, positions[i + 7]!, positions[i + 8]!);
        cb.subVectors(c, b);
        ab.subVectors(a, b);
        cb.cross(ab).normalize();
        for (let k = 0; k < 3; k += 1) {
          normals[i + k * 3] = cb.x;
          normals[i + k * 3 + 1] = cb.y;
          normals[i + k * 3 + 2] = cb.z;
        }
      }
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
      geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
      geometry.setAttribute('color', new Float32BufferAttribute(new Float32Array(buffers.colors), 3));
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      result.set(layer, geometry);
    }
    return result;
  }

  private buffers(): LayerBuffers {
    let buffers = this.layers.get(this.layer);
    if (!buffers) {
      buffers = new LayerBuffers();
      this.layers.set(this.layer, buffers);
    }
    return buffers;
  }

  private addScaled(
    source: BufferGeometry,
    color: number,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    rotation?: Rotation,
  ): this {
    tmpEuler.set(rotation?.x ?? 0, rotation?.y ?? 0, rotation?.z ?? 0, 'YXZ');
    tmpQuaternion.setFromEuler(tmpEuler);
    tmpPosition.set(x, y, z);
    tmpScale.set(sx, sy, sz);
    tmpMatrix.compose(tmpPosition, tmpQuaternion, tmpScale).premultiply(this.current);
    const flip = tmpMatrix.determinant() < 0;
    const position = source.getAttribute('position');
    const buffers = this.buffers();
    tmpColor.setHex(color);
    const count = position.count;
    for (let i = 0; i < count; i += 3) {
      for (let k = 0; k < 3; k += 1) {
        const index = flip ? i + (k === 0 ? 0 : 3 - k) : i + k;
        tmpPosition.fromBufferAttribute(position, index).applyMatrix4(tmpMatrix);
        buffers.positions.push(tmpPosition.x, tmpPosition.y, tmpPosition.z);
        buffers.colors.push(tmpColor.r, tmpColor.g, tmpColor.b);
      }
    }
    return this;
  }
}

function ringPoints(section: LoftSection): number[][] {
  const hw = section.w / 2;
  const hh = section.h / 2;
  const bevel = Math.min(0.9, Math.max(0, section.bevel ?? 0.3));
  const bx = hw * bevel;
  const by = hh * bevel;
  const { y, z } = section;
  // Counter-clockwise seen from +z: right-bottom, right-top, top-right, top-left, ...
  const points: Array<[number, number]> =
    bevel <= 0.001
      ? [
          [hw, -hh],
          [hw, hh],
          [-hw, hh],
          [-hw, -hh],
        ]
      : [
          [hw, -hh + by],
          [hw, hh - by],
          [hw - bx, hh],
          [-hw + bx, hh],
          [-hw, hh - by],
          [-hw, -hh + by],
          [-hw + bx, -hh],
          [hw - bx, -hh],
        ];
  return points.map(([px, py]) => [px, y + py, z]);
}

/** Multiply an sRGB hex colour's channels by `factor` (clamped). */
export function darken(hex: number, factor: number): number {
  const r = Math.min(255, Math.round(((hex >> 16) & 0xff) * factor));
  const g = Math.min(255, Math.round(((hex >> 8) & 0xff) * factor));
  const bl = Math.min(255, Math.round((hex & 0xff) * factor));
  return (r << 16) | (g << 8) | bl;
}

/** Blend two sRGB hex colours. */
export function mix(from: number, to: number, t: number): number {
  const r = Math.round(((from >> 16) & 0xff) * (1 - t) + ((to >> 16) & 0xff) * t);
  const g = Math.round(((from >> 8) & 0xff) * (1 - t) + ((to >> 8) & 0xff) * t);
  const bl = Math.round((from & 0xff) * (1 - t) + (to & 0xff) * t);
  return (r << 16) | (g << 8) | bl;
}
