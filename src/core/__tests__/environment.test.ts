import { describe, it, expect } from 'vitest';
import { DirectionalLight, FogExp2, Scene } from 'three';
import { computeSunVector, createEnvironment, FOG_DENSITY, HORIZON_COLOR } from '../environment';

describe('computeSunVector', () => {
  it('maps elevation 90 to straight up', () => {
    const v = computeSunVector(90, 0);
    expect(v.x).toBeCloseTo(0, 6);
    expect(v.y).toBeCloseTo(1, 6);
    expect(v.z).toBeCloseTo(0, 6);
  });

  it('maps horizon azimuths to the XZ plane (0 -> +Z, 90 -> +X)', () => {
    const south = computeSunVector(0, 0);
    expect(south.x).toBeCloseTo(0, 6);
    expect(south.y).toBeCloseTo(0, 6);
    expect(south.z).toBeCloseTo(1, 6);

    const east = computeSunVector(0, 90);
    expect(east.x).toBeCloseTo(1, 6);
    expect(east.y).toBeCloseTo(0, 6);
    expect(east.z).toBeCloseTo(0, 6);
  });

  it('always returns a unit-length vector', () => {
    for (const [elev, az] of [[35, 45], [54.7356, 45], [-12, 210], [80, 300]] as const) {
      const v = computeSunVector(elev, az);
      expect(v.length()).toBeCloseTo(1, 6);
    }
  });

  it('round-trips the boot sun light position (100, 200, 100)', () => {
    const dir = new DirectionalLight(0xffffff, 1);
    dir.position.set(100, 200, 100);
    const n = dir.position.clone().normalize();
    const elev = 90 - (Math.acos(n.y) * 180) / Math.PI;
    const az = (Math.atan2(n.x, n.z) * 180) / Math.PI;
    const v = computeSunVector(elev, az);
    expect(v.x).toBeCloseTo(n.x, 5);
    expect(v.y).toBeCloseTo(n.y, 5);
    expect(v.z).toBeCloseTo(n.z, 5);
  });
});

describe('createEnvironment', () => {
  it('adds a sky dome and retunes fog density/color without GL', () => {
    const scene = new Scene();
    scene.fog = new FogExp2(0xddebff, 0.008);
    const sun = new DirectionalLight(0xffd7a1, 1.1);
    sun.position.set(100, 200, 100);

    const env = createEnvironment(scene, { sunLight: sun, worldRadius: 900 });
    expect(scene.children).toContain(env.sky);

    const fog = scene.fog as FogExp2;
    expect(fog.density).toBeCloseTo(FOG_DENSITY, 8);
    expect(fog.color.getHexString()).toBe(HORIZON_COLOR.replace('#', '').toLowerCase());
    expect(FOG_DENSITY).toBeLessThanOrEqual(0.0025);

    // Sky sun uniform matches the existing light's normalized position.
    const u = env.uniforms.sunPosition.value;
    const n = sun.position.clone().normalize();
    expect(u.x).toBeCloseTo(n.x, 5);
    expect(u.y).toBeCloseTo(n.y, 5);
    expect(u.z).toBeCloseTo(n.z, 5);
  });

  it('setSunDirection keeps the sky uniform and light direction in sync', () => {
    const scene = new Scene();
    const sun = new DirectionalLight(0xffffff, 1);
    sun.position.set(0, 244.9, 0);
    const env = createEnvironment(scene, { sunLight: sun });

    env.setSunDirection(20, 135);
    const expected = computeSunVector(20, 135);
    const u = env.uniforms.sunPosition.value;
    expect(u.x).toBeCloseTo(expected.x, 6);
    expect(u.y).toBeCloseTo(expected.y, 6);
    expect(u.z).toBeCloseTo(expected.z, 6);

    const ln = sun.position.clone().normalize();
    expect(ln.x).toBeCloseTo(expected.x, 6);
    expect(ln.y).toBeCloseTo(expected.y, 6);
    expect(ln.z).toBeCloseTo(expected.z, 6);
    // Light distance is preserved so the shadow camera keeps working.
    expect(sun.position.length()).toBeCloseTo(244.9, 3);
  });

  it('replaces non-FogExp2 fog with a tuned FogExp2', () => {
    const scene = new Scene();
    createEnvironment(scene, {});
    const fog = scene.fog;
    expect(fog).toBeInstanceOf(FogExp2);
    expect((fog as FogExp2).density).toBeCloseTo(FOG_DENSITY, 8);
  });
});
