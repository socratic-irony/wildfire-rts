import { describe, expect, it } from 'vitest';
import { WebGLRenderer } from 'three';
import { QualityController, readQualityOptions } from './quality';

function fakeRenderer() {
  const state = { pixelRatio: 0, shadow: { autoUpdate: true, needsUpdate: false } };
  const renderer = {
    setPixelRatio: (ratio: number) => {
      state.pixelRatio = ratio;
    },
    shadowMap: state.shadow,
  } as unknown as WebGLRenderer;
  return { renderer, state };
}

describe('quality controller', () => {
  it('caps the pixel ratio at 1.5 unless the URL raises it', () => {
    expect(readQualityOptions(new URLSearchParams(''), 2).maxPixelRatio).toBe(1.5);
    expect(readQualityOptions(new URLSearchParams('dpr=2'), 2).maxPixelRatio).toBe(2);
    expect(readQualityOptions(new URLSearchParams(''), 1).maxPixelRatio).toBe(1);
    expect(readQualityOptions(new URLSearchParams('fps=120'), 1).maxFps).toBe(120);
  });

  it('caps frames at 60 fps in play and 30 when relaxed', () => {
    const { renderer } = fakeRenderer();
    const quality = new QualityController(renderer, { maxFps: 60, maxPixelRatio: 1, showStats: false });
    quality.recordFrame(1000, 1, 1);
    expect(quality.shouldRender(1008, false)).toBe(false);
    expect(quality.shouldRender(1016.7, false)).toBe(true);
    expect(quality.shouldRender(1016.7, true)).toBe(false);
    expect(quality.shouldRender(1033.4, true)).toBe(true);
  });

  it('redraws shadows at most 30 times a second, and not at all when nothing moves', () => {
    const { renderer, state } = fakeRenderer();
    const quality = new QualityController(renderer, { maxFps: 60, maxPixelRatio: 1, showStats: false });
    expect(state.shadow.autoUpdate).toBe(false);
    let updates = 0;
    for (let frame = 0; frame < 60; frame += 1) {
      state.shadow.needsUpdate = false;
      quality.prepareShadows(frame * (1000 / 60), true);
      if (state.shadow.needsUpdate) updates += 1;
    }
    expect(updates).toBeGreaterThanOrEqual(29);
    expect(updates).toBeLessThanOrEqual(31);
    updates = 0;
    for (let frame = 60; frame < 120; frame += 1) {
      state.shadow.needsUpdate = false;
      quality.prepareShadows(frame * (1000 / 60), false);
      if (state.shadow.needsUpdate) updates += 1;
    }
    expect(updates).toBe(0);
    quality.markShadowsDirty();
    quality.prepareShadows(3000, false);
    expect(state.shadow.needsUpdate).toBe(true);
  });

  it('lowers resolution when frames run long and recovers with headroom', () => {
    const { renderer, state } = fakeRenderer();
    const quality = new QualityController(renderer, { maxFps: 60, maxPixelRatio: 1.5, showStats: false });
    expect(state.pixelRatio).toBe(1.5);
    let now = 0;
    for (let i = 0; i < 80; i += 1) quality.recordFrame((now += 40), 1, 1);
    expect(state.pixelRatio).toBe(1);
    for (let i = 0; i < 1200; i += 1) quality.recordFrame((now += 16.7), 1, 1);
    expect(state.pixelRatio).toBe(1.5);
  });
});
