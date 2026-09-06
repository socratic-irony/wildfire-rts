import { describe, expect, it } from 'vitest';
import { getHydrantStatusLabel } from '../vehicleHud';

describe('vehicle HUD hydrant status', () => {
  it('uses explicit labels for connection, refill, and fallback states', () => {
    expect(getHydrantStatusLabel('connected')).toBe('Hydrant connected');
    expect(getHydrantStatusLabel('refilling')).toBe('Refilling at hydrant');
    expect(getHydrantStatusLabel('en-route')).toBe('Driving to hydrant');
    expect(getHydrantStatusLabel('unavailable')).toBe('No active hydrant — returning');
    expect(getHydrantStatusLabel('none')).toBe('No hydrant connection');
  });
});
