import type { FollowerEntry } from './followerOrders';
import { VehicleType } from './types';
import { getDefaults } from './typeDefaults';

export type FleetStats = {
  total: number;
  byType: Record<VehicleType, number>;
  moving: number;
  idle: number;
  meanSpeed: number;
  maxSpeed: number;
  totalWaterCapacity: number;
};

const SPEED_IDLE_THRESHOLD = 0.05;

function emptyByType(): Record<VehicleType, number> {
  return {
    [VehicleType.CAR]: 0,
    [VehicleType.FIRETRUCK]: 0,
    [VehicleType.BULLDOZER]: 0,
    [VehicleType.HELICOPTER]: 0,
    [VehicleType.AIRPLANE]: 0,
    [VehicleType.FIREFIGHTER]: 0,
  };
}

export function computeFleetStats(followers: ReadonlyArray<FollowerEntry>): FleetStats {
  const byType = emptyByType();
  let moving = 0;
  let speedSum = 0;
  let maxSpeed = 0;
  let waterSum = 0;

  for (const entry of followers) {
    byType[entry.type] += 1;
    const v = entry.follower.v;
    if (v > SPEED_IDLE_THRESHOLD) moving += 1;
    speedSum += v;
    if (v > maxSpeed) maxSpeed = v;
    waterSum += getDefaults(entry.type).waterCapacity;
  }

  const total = followers.length;
  return {
    total,
    byType,
    moving,
    idle: total - moving,
    meanSpeed: total > 0 ? speedSum / total : 0,
    maxSpeed,
    totalWaterCapacity: waterSum,
  };
}
