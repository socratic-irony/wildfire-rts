import { describe, expect, it, vi } from 'vitest';
import type { Path2D } from '../../paths/path2d';
import type { PathFollower } from '../frenet';
import { IntersectionManager, type IntersectionInfo } from '../intersectionManager';

function path(length = 100, closed = true) {
  return { length, closed } as Path2D;
}

function follower(s: number, v = 0) {
  return {
    s,
    v,
    brake: 12,
    setSpeedCap: vi.fn(),
  } as unknown as PathFollower;
}

function intersection(id = 0, s = 50): IntersectionInfo {
  return { id, s, pos: { x: 50, z: 50 } };
}

describe('IntersectionManager traffic arbitration', () => {
  it('holds and grants a vehicle approaching on the low-s side of a closed loop', () => {
    const p = path();
    const info = intersection();
    const car = follower(48.5);
    const manager = new IntersectionManager();
    manager.setPaths([{ path: p, intersections: [info] }]);

    for (let i = 0; i < 12; i++) {
      manager.updateBeforeMovement([{ id: 7, follower: car, path: p }], 0.1);
    }

    const snapshot = manager.getSnapshot();
    expect(snapshot.intersections[0].occupantId).toBe(7);
    expect(car.setSpeedCap).toHaveBeenCalledWith(4, expect.any(Number));
  });

  it('breaks simultaneous full-stop ties by follower id regardless of input order', () => {
    const a = path();
    const b = path();
    const info = intersection(3);
    const highId = follower(48.5);
    const lowId = follower(48.5);
    const manager = new IntersectionManager();
    manager.setPaths([
      { path: a, intersections: [info] },
      { path: b, intersections: [info] },
    ]);

    for (let i = 0; i < 12; i++) {
      manager.updateBeforeMovement([
        { id: 20, follower: highId, path: a },
        { id: 4, follower: lowId, path: b },
      ], 0.1);
    }

    const snapshot = manager.getSnapshot().intersections[0];
    expect(snapshot.occupantId).toBe(4);
    expect(snapshot.queue).toEqual([20]);
  });

  it('keeps the queue stopped while the outbound clearance probe is blocked', () => {
    const p = path();
    const info = intersection(5);
    const car = follower(48.5);
    const manager = new IntersectionManager();
    manager.setPaths([{ path: p, intersections: [info] }]);
    manager.setCanEnterProbe(() => false);

    for (let i = 0; i < 20; i++) {
      manager.updateBeforeMovement([{ id: 2, follower: car, path: p }], 0.1);
    }

    const snapshot = manager.getSnapshot().intersections[0];
    expect(snapshot.occupantId).toBeNull();
    expect(snapshot.queue).toEqual([2]);
  });

  it('releases occupancy only after the vehicle clears the conflict area', () => {
    const p = path();
    const info = intersection(9);
    const car = follower(48.5);
    const manager = new IntersectionManager();
    manager.setPaths([{ path: p, intersections: [info] }]);

    for (let i = 0; i < 12; i++) {
      manager.updateBeforeMovement([{ id: 1, follower: car, path: p }], 0.1);
    }
    car.s = 52;
    manager.postUpdateFollower(car, p);
    expect(manager.getSnapshot().intersections[0].occupantId).toBe(1);

    car.s = 55;
    manager.postUpdateFollower(car, p);
    expect(manager.getSnapshot().intersections[0].occupantId).toBeNull();
  });

  it('uses a braking envelope before the stop line', () => {
    const p = path();
    const car = follower(44, 8);
    const manager = new IntersectionManager();
    manager.setPaths([{ path: p, intersections: [intersection(11)] }]);

    manager.updateBeforeMovement([{ id: 3, follower: car, path: p }], 0.05);

    const caps = (car.setSpeedCap as ReturnType<typeof vi.fn>).mock.calls.map(([cap]) => cap as number);
    expect(caps.some((cap) => cap > 0 && cap < 8)).toBe(true);
  });

  it('controls both approaches when a closed path crosses itself', () => {
    const p = path();
    const car = follower(68.5);
    const manager = new IntersectionManager();
    manager.setPaths([{ path: p, intersections: [intersection(12, 20), intersection(12, 70)] }]);

    for (let i = 0; i < 12; i++) {
      manager.updateBeforeMovement([{ id: 8, follower: car, path: p }], 0.1);
    }

    expect(manager.getSnapshot().intersections[0].occupantId).toBe(8);
  });
});
