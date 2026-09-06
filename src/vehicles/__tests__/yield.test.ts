import { describe, it, expect } from 'vitest';
import { Object3D } from 'three';
import { PathFollower } from '../frenet';
import { generateHeightmap } from '../../terrain/heightmap';
import { Path2D } from '../../paths/path2d';

function makeFollower() {
  const hm = generateHeightmap(16, 16, 1, { seed: 's', frequency: 0, amplitude: 0, octaves: 1, persistence: 1 });
  const path = new Path2D([{ x: 1, z: 8 }, { x: 14, z: 8 }]);
  const obj = new Object3D();
  return new PathFollower(path, hm, obj, 0);
}

describe('PathFollower.isYielding', () => {
  it('leaves an open-path endpoint with bounded reverse travel', () => {
    const hm = generateHeightmap(16, 16, 1, { seed: 's', frequency: 0, amplitude: 0, octaves: 1, persistence: 1 });
    const path = new Path2D([{ x: 1, z: 8 }, { x: 14, z: 8 }]);
    const follower = new PathFollower(path, hm, new Object3D(), path.length);

    follower.setTargetS(0, true);
    follower.update(0.1);

    expect(follower.s).toBeGreaterThan(0);
    expect(follower.s).toBeLessThan(path.length);
    expect(path.length - follower.s).toBeLessThanOrEqual(1.0);

    let previousS = follower.s;
    for (let i = 0; i < 200 && follower.targetS !== null; i++) {
      follower.update(0.1);
      expect(follower.s).toBeLessThanOrEqual(previousS);
      expect(previousS - follower.s).toBeLessThanOrEqual(1.0);
      previousS = follower.s;
    }
    expect(follower.s).toBe(0);
    expect(follower.targetS).toBeNull();
  });

  it('rides above the raised road surface instead of being hidden underneath it', () => {
    const f = makeFollower();
    expect(f.object.matrix.elements[13]).toBeGreaterThan(0.3);
    f.update(0.1);
    expect(f.object.matrix.elements[13]).toBeGreaterThan(0.3);
  });

  it('is false when no speed cap is active', () => {
    const f = makeFollower();
    expect(f.isYielding()).toBe(false);
  });

  it('is true while a low speed cap is active', () => {
    const f = makeFollower();
    f.setSpeedCap(0, 1.0);
    expect(f.isYielding()).toBe(true);
    f.setSpeedCap(0.5, 1.0);
    expect(f.isYielding()).toBe(true);
  });

  it('is false once the cap timer expires', () => {
    const f = makeFollower();
    f.setSpeedCap(0, 0.1);
    expect(f.isYielding()).toBe(true);
    // Simulate the timer elapsing.
    f.update(0.2);
    expect(f.isYielding()).toBe(false);
  });

  it('is false for high caps (e.g., approach speed, not a stop)', () => {
    const f = makeFollower();
    f.setSpeedCap(4, 1.0);
    expect(f.isYielding()).toBe(false);
  });
});
