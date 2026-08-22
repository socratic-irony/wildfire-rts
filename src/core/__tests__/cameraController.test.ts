import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { CameraController } from '../cameraController';

function makeController(opts?: ConstructorParameters<typeof CameraController>[2]) {
  const camera = new PerspectiveCamera(60, 16 / 9, 0.1, 1000);
  return new CameraController(null, camera, opts);
}

const SETTLE_FRAMES = 240; // plenty for lambda=10 exponential convergence

describe('CameraController', () => {
  it('damps dist toward the zoom goal with framerate-independent convergence', () => {
    const perFrame = makeController({ initialDist: 40 });
    const coarse = makeController({ initialDist: 40 });

    perFrame.zoom(-3);
    coarse.zoom(-3);

    for (let i = 0; i < 120; i++) {
      perFrame.update(1 / 60);
      if (i % 10 === 0) coarse.update(10 / 60);
    }

    const goalDist = 40 * Math.pow(0.9, -3); // per-notch factor 0.9, zoom out by 3 notches
    expect(Math.abs(perFrame.getState().dist - goalDist)).toBeLessThan(0.01);

    for (let i = 0; i < 12; i++) coarse.update(1 / 12);

    expect(Math.abs(perFrame.getState().dist - coarse.getState().dist)).toBeLessThan(0.05);
  });

  it('clamps pitch to [minPitch, maxPitch] under extreme rotate()', () => {
    const up = makeController({});
    up.rotate(0, 100000);
    for (let i = 0; i < SETTLE_FRAMES; i++) up.update(1 / 60);
    expect(up.getState().pitch).toBeLessThanOrEqual(1.45 + 1e-6);
    expect(Math.abs(up.getState().pitch - 1.45)).toBeLessThan(0.001);

    const down = makeController({});
    down.rotate(0, -100000);
    for (let i = 0; i < SETTLE_FRAMES; i++) down.update(1 / 60);
    expect(down.getState().pitch).toBeGreaterThanOrEqual(0.15 - 1e-6);
    expect(Math.abs(down.getState().pitch - 0.15)).toBeLessThan(0.001);
  });

  it('clamps dist to [minDist, maxDist] under huge zoom', () => {
    const out = makeController({ initialDist: 40 });
    out.zoom(-500);
    for (let i = 0; i < SETTLE_FRAMES; i++) out.update(1 / 60);
    expect(Math.abs(out.getState().dist - 320)).toBeLessThan(0.01);

    const inC = makeController({ initialDist: 40 });
    inC.zoom(500);
    for (let i = 0; i < SETTLE_FRAMES; i++) inC.update(1 / 60);
    expect(Math.abs(inC.getState().dist - 4)).toBeLessThan(0.01);
  });

  it('scales keyboard pan speed with dist/refDist (~4x between dist 20 and 80)', () => {
    const panDisplacement = (initialDist: number) => {
      const c = makeController({ initialDist: initialDist });
      const s0 = c.getState();
      for (let i = 0; i < 120; i++) c.update(1 / 60, { up: true });
      const s1 = c.getState();
      return Math.hypot(s1.x - s0.x, s1.z - s0.z);
    };

    const near = panDisplacement(20);
    const far = panDisplacement(80);

    expect(near).toBeGreaterThan(1);
    expect(far / near).toBeGreaterThan(4 - 0.8);
    expect(far / near).toBeLessThan(4 + 0.8);
  });

  it('hard-clamps target x/z to bounds', () => {
    const c = makeController({ initialTarget: { x: 0, z: 0 }, initialYaw: 0 });
    c.setBounds({ minX: -10, maxX: 10, minZ: -10, maxZ: 10 });

    for (let i = 0; i < 60; i++) {
      c.panPixels(200, 200);
      c.update(1 / 60);
    }

    const s = c.getState();
    expect(s.x).toBeGreaterThanOrEqual(-10);
    expect(s.x).toBeLessThanOrEqual(10);
    expect(s.z).toBeGreaterThanOrEqual(-10);
    expect(s.z).toBeLessThanOrEqual(10);
  });

  it('zoom-to-cursor pulls target toward projected point and leaves centered targets put', () => {
    const offset = makeController({
      initialTarget: { x: 0, z: 0 },
      initialDist: 40,
      projectGround: () => ({ x: 10, z: 0 }),
    });
    offset.zoom(8, 0.5, -0.5); // strong zoom-in toward cursor point
    for (let i = 0; i < SETTLE_FRAMES; i++) offset.update(1 / 60);
    const movedGap = Math.hypot(offset.getState().x - 0, offset.getState().z - 0);
    expect(movedGap).toBeGreaterThanOrEqual(5); // >= 50% of the prior 10-unit gap

    let projected = { x: 0, z: 0 };
    const centered = makeController({
      initialTarget: { x: 0, z: 0 },
      initialDist: 40,
      projectGround: () => projected,
    });
    centered.zoom(8, 0.25, 0.25);
    const s = centered.getState();
    expect(Math.hypot(s.x, s.z)).toBeLessThan(0.01);

    projected = { x: 5, z: 5 };
    centered.zoom(8, 0.25, 0.25);
  });

  it('follow() tracks a moving provider and follow(null) restores free control', () => {
    const c = makeController({});
    let px = 0;
    let pz = 0;
    c.follow(() => ({ x: px, z: pz }));

    px = 42;
    pz = -13;
    c.update(1 / 60);
    let s = c.getState();
    expect(s.x).toBeCloseTo(42, 6);
    expect(s.z).toBeCloseTo(-13, 6);

    c.follow(null);
    c.panPixels(-300, 0);
    c.update(1 / 60);
    s = c.getState();
    expect(Math.abs(s.x - 42)).toBeGreaterThan(0.5);
  });

  it('focus() snaps goals and currents instantly before any update', () => {
    const c = makeController({ sampleHeight: () => 5 });
    c.focus(64.5, 64.5, 18, 24);

    const s = c.getState();
    expect(s.x).toBe(64.5);
    expect(s.z).toBe(64.5);
    expect(s.dist).toBe(18);
    const expectedPitch = Math.atan2(24 - 5, 18);
    expect(s.pitch).toBeCloseTo(expectedPitch, 6);
  });

  it('ignores rotate/pan/zoom intents while input-locked', () => {
    const c = makeController({});
    c.setInputLockCheck(() => true);
    const s0 = c.getState();

    c.rotate(80, 80);
    c.panPixels(150, -150);
    c.zoom(3);
    c.update(1 / 60);

    const s1 = c.getState();
    expect(s1.x).toBe(s0.x);
    expect(s1.z).toBe(s0.z);
    expect(s1.yaw).toBe(s0.yaw);
    expect(s1.pitch).toBe(s0.pitch);
    expect(s1.dist).toBe(s0.dist);
  });

  it('keyboard yawR/yawL rotates yaw and tiltU/tiltD changes pitch', () => {
    const yawer = makeController({});
    const y0 = yawer.getState().yaw;
    for (let i = 0; i < 60; i++) yawer.update(1 / 60, { yawR: true });
    expect(yawer.getState().yaw).toBeGreaterThan(y0 + 0.5);

    const tilter = makeController({});
    const p0 = tilter.getState().pitch;
    for (let i = 0; i < 30; i++) tilter.update(1 / 60, { tiltU: true });
    expect(tilter.getState().pitch).toBeGreaterThan(p0 + 0.3);
    for (let i = 0; i < 60; i++) tilter.update(1 / 60, { tiltD: true });
    expect(tilter.getState().pitch).toBeLessThan(p0);
  });

  it('enforces terrain clearance above sampled ground height', () => {
    // Grazing pitch + tiny dist would put the camera below ground+clearance
    const c = makeController({ sampleHeight: () => 50, initialPitch: 0.15, initialDist: 4 });
    c.update(1 / 60);
    expect(c.camera.position.y).toBeGreaterThanOrEqual(52);
  });

  it('places the camera exactly on the spherical orbit and looks at the target', () => {
    const c = makeController({
      initialYaw: 0.7,
      initialPitch: 0.55,
      initialDist: 23,
      initialTarget: { x: 3, z: -4 },
    });
    c.update(1 / 60);

    const s = c.getState();
    const hR = s.dist * Math.cos(s.pitch);
    const camH = s.dist * Math.sin(s.pitch);
    const expectedX = 3 + Math.sin(s.yaw) * hR;
    const expectedY = camH; // no sampler -> target ground y is 0
    const expectedZ = -4 + Math.cos(s.yaw) * hR;

    const pos = c.camera.position;
    expect(Math.abs(pos.x - expectedX)).toBeLessThan(1e-6);
    expect(Math.abs(pos.y - expectedY)).toBeLessThan(1e-6);
    expect(Math.abs(pos.z - expectedZ)).toBeLessThan(1e-6);

    const forward = new Vector3();
    c.camera.getWorldDirection(forward);
    const toTarget = new Vector3(3 - pos.x, 0 - pos.y, -4 - pos.z).normalize();
    expect(forward.dot(toTarget)).toBeGreaterThan(0.999);
  });
});
