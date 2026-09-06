import { describe, expect, it } from 'vitest';
import { Object3D } from 'three';
import { Path2D } from '../../paths/path2d';
import type { Heightmap } from '../../terrain/heightmap';
import { PathFollower } from '../frenet';
import { IntersectionManager } from '../intersectionManager';
import { createTurnRouter, type TurnRoute } from '../turnRouting';

describe('turn runtime', () => {
  it('moves a real follower onto a connected road while holding the junction until clearance', () => {
    const road = new Path2D([{x: 0, z: 50}, {x: 100, z: 50}]);
    const branch = new Path2D([{x: 50, z: 0}, {x: 50, z: 100}]);
    const info = {id: 3, s: 50, pos: {x: 50, z: 50}};
    const entries = [road, branch].map(path => ({path, intersections: [info]}));
    const router = createTurnRouter(entries);
    const hm: Heightmap = {width: 100, height: 100, scale: 1, data: new Float32Array(10201), sample: () => 0};
    const car = new PathFollower(road, hm, new Object3D(), 48.5);
    const manager = new IntersectionManager();
    manager.setPaths(entries);
    let granted: TurnRoute | null = null;
    manager.setTurnRouter((f, id, intersection) => router.chooseRoute(f.path, f.s, intersection, id));
    manager.setTurnGranted((_f, _id, route) => {granted = route;});
    for (let i = 0; i < 12; i++) manager.updateBeforeMovement([{id: 0, follower: car, path: car.path}], 0.1);
    expect(granted).not.toBeNull();
    const route = granted as unknown as TurnRoute;
    expect(car.path).toBe(route.path);
    expect(route.continuationPath).not.toBe(road);
    for (let i = 0; i < 600 && car.s < route.clearS - 1e-3; i++) {
      manager.updateBeforeMovement([{id: 0, follower: car, path: car.path}], 0.05);
      expect(manager.getSnapshot().intersections[0].occupantId).toBe(0);
      const previous = car.s;
      car.update(0.05);
      expect(car.s - previous).toBeLessThanOrEqual(car.v * 0.05 + 1e-5);
      manager.postUpdateFollower(car, car.path);
      if (car.s < route.clearS - 1e-3) expect(manager.getSnapshot().intersections[0].occupantId).toBe(0);
    }
    expect(car.s).toBeCloseTo(route.clearS, 3);
    expect(manager.getSnapshot().intersections[0].occupantId).toBeNull();
    expect(car.forcePathProgress).toBe(false);
    const end = car.path.sample(car.s).p;
    const next = route.continuationPath.sample(route.continuationS).p;
    expect(Math.hypot(end.x - next.x, end.z - next.z)).toBeLessThan(0.001);
  });
});
