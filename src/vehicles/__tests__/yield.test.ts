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
