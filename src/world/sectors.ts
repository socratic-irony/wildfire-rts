import { GRID_SIZE } from './constants';

const SECTORS = [
  'North Ridge',
  'Pine Bench',
  'Cedar Hollow',
  'South Flats',
  'West Basin',
  'East Draw',
  'Town Rim',
  'Raven Spur',
  'Dry Gulch',
  'Lookout Peak',
  'Mill Creek',
  'Ash Flats',
];

export function sectorNameFor(tx: number, tz: number): string {
  const cx = GRID_SIZE / 2;
  const cz = GRID_SIZE / 2;
  if (tz < cz - 15) return tx > cx ? SECTORS[1]! : SECTORS[0]!;
  if (tz > cz + 15) return tx > cx ? SECTORS[2]! : SECTORS[3]!;
  if (tx < cx - 15) return SECTORS[4]!;
  if (tx > cx + 15) return SECTORS[5]!;
  if (tz < cz - 5) return SECTORS[9]!;
  if (tz > cz + 8) return SECTORS[10]!;
  if (tx < cx - 5) return SECTORS[7]!;
  if (tx > cx + 8) return SECTORS[8]!;
  return SECTORS[6]!;
}

export function severityLabel(severity: number): string {
  if (severity <= 0) return 'Mop-up';
  if (severity <= 2) return 'Spot fire';
  if (severity <= 10) return 'Growing';
  if (severity <= 24) return 'Major';
  return 'Conflagration';
}

export function severityClass(severity: number): string {
  if (severity <= 2) return 'low';
  if (severity <= 10) return 'medium';
  if (severity <= 24) return 'high';
  return 'critical';
}
