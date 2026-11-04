export interface Vec2 {
  x: number;
  z: number;
}

export const TAU = Math.PI * 2;

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function inverseLerp(a: number, b: number, value: number): number {
  return a === b ? 0 : clamp((value - a) / (b - a), 0, 1);
}

export function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = inverseLerp(edge0, edge1, value);
  return t * t * (3 - 2 * t);
}

export function distance2(ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  return dx * dx + dz * dz;
}

export function distance(ax: number, az: number, bx: number, bz: number): number {
  return Math.sqrt(distance2(ax, az, bx, bz));
}

export function angleDelta(from: number, to: number): number {
  let delta = (to - from) % TAU;
  if (delta > Math.PI) delta -= TAU;
  if (delta < -Math.PI) delta += TAU;
  return delta;
}

export function angleLerp(from: number, to: number, t: number): number {
  return from + angleDelta(from, to) * clamp(t, 0, 1);
}

export function damp(current: number, target: number, lambda: number, dt: number): number {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}

export function dampAngle(current: number, target: number, lambda: number, dt: number): number {
  return angleLerp(current, target, 1 - Math.exp(-lambda * dt));
}

export function pointInEllipse(x: number, z: number, cx: number, cz: number, rx: number, rz: number): boolean {
  const dx = (x - cx) / rx;
  const dz = (z - cz) / rz;
  return dx * dx + dz * dz <= 1;
}

export function normalizeAngle(angle: number): number {
  return ((angle % TAU) + TAU) % TAU;
}
