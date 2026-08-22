import { describe, it, expect } from 'vitest';
import type { DirectionalLight, OrthographicCamera } from 'three';
import { createScene } from '../scene';

function findSun(scene: ReturnType<typeof createScene>): DirectionalLight {
  const sun = scene.children.find((child) => (child as DirectionalLight).isDirectionalLight);
  expect(sun).toBeDefined();
  return sun as DirectionalLight;
}

describe('createScene', () => {
  it('adds the sun and its target to the scene', () => {
    const scene = createScene();
    const sun = findSun(scene);
    expect(sun.castShadow).toBe(true);
    expect(scene.children).toContain(sun.target);
  });

  it('positions the sun target at the requested world center', () => {
    const center = { x: 40, z: -20 };
    const scene = createScene({ worldCenter: center });
    const sun = findSun(scene);
    expect(sun.target.position.x).toBeCloseTo(center.x);
    expect(sun.target.position.z).toBeCloseTo(center.z);
    // Sun offset from the target so shadows fall across the play area.
    expect(sun.position.x).toBeGreaterThan(center.x);
    expect(sun.position.y).toBeGreaterThan(0);
    expect(sun.position.z).toBeGreaterThan(center.z);
  });

  it('sizes the shadow ortho frustum to cover at least the requested extent', () => {
    const extent = 120;
    const scene = createScene({ worldCenter: { x: 10, z: 10 }, shadowExtent: extent });
    const cam = findSun(scene).shadow.camera as OrthographicCamera;
    expect(cam.right - cam.left).toBeGreaterThanOrEqual(2 * extent);
    expect(cam.top - cam.bottom).toBeGreaterThanOrEqual(2 * extent);
    // Frustum is centered on the target (±extent box).
    expect(cam.left).toBeCloseTo(-extent);
    expect(cam.right).toBeCloseTo(extent);
    expect(cam.top).toBeCloseTo(extent);
    expect(cam.bottom).toBeCloseTo(-extent);
  });

  it('defaults the shadow box around the default world center with sane bias values', () => {
    const scene = createScene();
    const sun = findSun(scene);
    const cam = sun.shadow.camera as OrthographicCamera;
    expect(cam.right - cam.left).toBeGreaterThanOrEqual(192); // 2 * 96
    expect(sun.target.position.x).toBeCloseTo(64);
    expect(sun.target.position.z).toBeCloseTo(64);
    expect(sun.shadow.bias).toBeCloseTo(-0.0005);
    expect(sun.shadow.normalBias).toBeCloseTo(0.02);
  });
});
