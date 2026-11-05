export type DifficultyId = 'calm' | 'standard' | 'redflag';

export interface Difficulty {
  id: DifficultyId;
  label: string;
  tagline: string;
  /** Scripted lightning strikes, in shift seconds. */
  ignitionTimes: number[];
  /** Forecast wind shifts, in shift seconds. */
  windShiftTimes: number[];
  startWindSpeed: number;
  /** Speed range (m/s) drawn for each wind shift. */
  windSpeedRange: [number, number];
  spreadMultiplier: number;
  spotMultiplier: number;
  startingFunds: number;
  /** Command budget earned per simulated second. */
  income: number;
  /** Paid when an incident is contained. */
  containmentBonus: number;
  burnLimitHectares: number;
  structureLossLimit: number;
  scoreMultiplier: number;
}

export const DIFFICULTIES: Record<DifficultyId, Difficulty> = {
  calm: {
    id: 'calm',
    label: 'Calm',
    tagline: 'Three strikes, light wind, a generous budget.',
    ignitionTimes: [30, 120, 230],
    windShiftTimes: [90, 210, 340],
    startWindSpeed: 4.2,
    windSpeedRange: [3.2, 6.6],
    spreadMultiplier: 0.82,
    spotMultiplier: 0.6,
    startingFunds: 450,
    income: 2.2,
    containmentBonus: 150,
    burnLimitHectares: 2.2,
    structureLossLimit: 12,
    scoreMultiplier: 0.8,
  },
  standard: {
    id: 'standard',
    label: 'Standard',
    tagline: 'Four strikes and shifting afternoon wind.',
    ignitionTimes: [26, 94, 172, 266],
    windShiftTimes: [70, 190, 310, 420],
    startWindSpeed: 5.4,
    windSpeedRange: [4.2, 9.4],
    spreadMultiplier: 1,
    spotMultiplier: 1,
    startingFunds: 320,
    income: 1.6,
    containmentBonus: 120,
    burnLimitHectares: 1.6,
    structureLossLimit: 10,
    scoreMultiplier: 1,
  },
  redflag: {
    id: 'redflag',
    label: 'Red Flag',
    tagline: 'Six strikes, gusting wind, embers everywhere.',
    ignitionTimes: [20, 72, 128, 190, 255, 325],
    windShiftTimes: [60, 150, 240, 330, 410],
    startWindSpeed: 7.2,
    windSpeedRange: [6.2, 11.2],
    spreadMultiplier: 1.12,
    spotMultiplier: 1.45,
    startingFunds: 260,
    income: 1.3,
    containmentBonus: 110,
    burnLimitHectares: 1.6,
    structureLossLimit: 8,
    scoreMultiplier: 1.5,
  },
};

export const DIFFICULTY_ORDER: DifficultyId[] = ['calm', 'standard', 'redflag'];

export function parseDifficulty(value: string | null | undefined): DifficultyId | null {
  if (value === 'calm' || value === 'standard' || value === 'redflag') return value;
  return null;
}
