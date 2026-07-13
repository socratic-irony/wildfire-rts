import { describe, expect, it } from 'vitest';
import { createLcg } from '../random';

describe('createLcg', () => {
  it('produces the pinned sequence for a fixed seed', () => {
    const random = createLcg(12345);

    expect(Array.from({ length: 6 }, () => random())).toEqual([
      0.02040268574385035,
      0.016547848241531254,
      0.5431557946240426,
      0.634904056236824,
      0.9100295139732839,
      0.11246166916388592,
    ]);
  });

  it('keeps generator state independent', () => {
    const first = createLcg(12345);
    const second = createLcg(12345);

    first();
    first();

    expect(second()).toBe(0.02040268574385035);
    expect(first()).toBe(0.5431557946240426);
  });
});
