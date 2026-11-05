import { WebGLRenderer } from 'three';

/**
 * Frame pacing and resolution for the render loop, tuned to keep laptops
 * cool without changing what the scene looks like:
 *
 * - Frames are capped (60 fps in play, 30 while paused, on the briefing and
 *   on the end screen); high-refresh displays no longer render 120+ fps.
 * - The pixel ratio starts at min(devicePixelRatio, 1.5) and adapts: if
 *   frames run long it steps down toward 1, and steps back up when there is
 *   headroom.
 * - The shadow map re-renders at most 30 times a second, and only while
 *   something that casts a shadow can have moved (or after a discrete change).
 *
 * URL overrides: `fps=<cap>`, `dpr=<max pixel ratio>`, `stats=1` for an
 * on-screen readout.
 */
export interface QualityOptions {
  maxFps: number;
  maxPixelRatio: number;
  showStats: boolean;
}

export function readQualityOptions(params: URLSearchParams, devicePixelRatio: number): QualityOptions {
  const fps = Number(params.get('fps'));
  const dpr = Number(params.get('dpr'));
  return {
    maxFps: Number.isFinite(fps) && fps >= 15 ? Math.min(240, fps) : 60,
    maxPixelRatio: Math.min(devicePixelRatio || 1, Number.isFinite(dpr) && dpr > 0 ? Math.min(3, dpr) : 1.5),
    showStats: params.get('stats') === '1',
  };
}

/** Rolling frame statistics, in milliseconds. */
export interface FrameStats {
  fps: number;
  frameMs: number;
  cpuMs: number;
  renderMs: number;
  pixelRatio: number;
  shadowUpdates: number;
}

const WINDOW_MS = 1500;
const MIN_PIXEL_RATIO = 1;
const STEP = 0.25;

export class QualityController {
  readonly stats: FrameStats = { fps: 0, frameMs: 0, cpuMs: 0, renderMs: 0, pixelRatio: 1, shadowUpdates: 0 };
  private lastRender = 0;
  private windowStart = 0;
  private windowFrames = 0;
  private windowCpu = 0;
  private windowRender = 0;
  private windowShadows = 0;
  private headroomWindows = 0;
  private pixelRatio: number;
  private shadowDirty = true;
  private lastShadow = 0;
  private readout: HTMLElement | null = null;

  constructor(
    private readonly renderer: WebGLRenderer,
    private readonly options: QualityOptions,
  ) {
    this.pixelRatio = options.maxPixelRatio;
    renderer.setPixelRatio(this.pixelRatio);
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = true;
    this.stats.pixelRatio = this.pixelRatio;
    if (options.showStats && typeof document !== 'undefined') {
      this.readout = document.createElement('div');
      this.readout.className = 'perf-readout';
      document.body.appendChild(this.readout);
    }
  }

  /**
   * Whether to draw a frame now. `relaxed` (paused, briefing, end screen)
   * halves the cap.
   */
  shouldRender(now: number, relaxed: boolean): boolean {
    const cap = relaxed ? Math.min(30, this.options.maxFps) : this.options.maxFps;
    // Small tolerance so a 60 Hz display is not quantised down to 30 fps.
    return now - this.lastRender >= 1000 / cap - 2;
  }

  /** Something that casts a shadow moved or changed: redraw the shadow map soon. */
  markShadowsDirty(): void {
    this.shadowDirty = true;
  }

  /** Call right before rendering; decides whether this frame redraws shadows. */
  prepareShadows(now: number, moving: boolean): void {
    if (!(this.shadowDirty || moving)) return;
    if (now - this.lastShadow < 1000 / 30 - 2) return;
    this.renderer.shadowMap.needsUpdate = true;
    this.lastShadow = now;
    this.shadowDirty = false;
    this.windowShadows += 1;
  }

  /** Record one rendered frame: time spent in game code and in renderer.render. */
  recordFrame(now: number, cpuMs: number, renderMs: number): void {
    if (this.windowStart === 0) this.windowStart = now;
    this.lastRender = now;
    this.windowFrames += 1;
    this.windowCpu += cpuMs;
    this.windowRender += renderMs;
    const elapsed = now - this.windowStart;
    if (elapsed < WINDOW_MS) return;
    const frameMs = elapsed / Math.max(1, this.windowFrames);
    this.stats.fps = (this.windowFrames * 1000) / elapsed;
    this.stats.frameMs = frameMs;
    this.stats.cpuMs = this.windowCpu / this.windowFrames;
    this.stats.renderMs = this.windowRender / this.windowFrames;
    this.stats.shadowUpdates = (this.windowShadows * 1000) / elapsed;
    this.adapt(frameMs);
    this.windowStart = now;
    this.windowFrames = 0;
    this.windowCpu = 0;
    this.windowRender = 0;
    this.windowShadows = 0;
    if (this.readout) {
      this.readout.textContent = `${this.stats.fps.toFixed(0)} fps · cpu ${this.stats.cpuMs.toFixed(1)} ms · draw ${this.stats.renderMs.toFixed(1)} ms · ${this.pixelRatio.toFixed(2)}x · shadows ${this.stats.shadowUpdates.toFixed(0)}/s`;
    }
  }

  /** Step resolution down when frames run long, back up when there is headroom. */
  private adapt(frameMs: number): void {
    if (typeof document !== 'undefined' && document.hidden) return;
    const budget = 1000 / this.options.maxFps;
    if (frameMs > budget * 1.3 && this.pixelRatio > MIN_PIXEL_RATIO) {
      this.setPixelRatio(Math.max(MIN_PIXEL_RATIO, this.pixelRatio - STEP));
      this.headroomWindows = 0;
      return;
    }
    if (frameMs < budget * 1.08 && this.pixelRatio < this.options.maxPixelRatio) {
      this.headroomWindows += 1;
      if (this.headroomWindows >= 3) {
        this.setPixelRatio(Math.min(this.options.maxPixelRatio, this.pixelRatio + STEP));
        this.headroomWindows = 0;
      }
    } else {
      this.headroomWindows = 0;
    }
  }

  private setPixelRatio(ratio: number): void {
    this.pixelRatio = ratio;
    this.stats.pixelRatio = ratio;
    this.renderer.setPixelRatio(ratio);
  }
}
