export type SoundCue =
  | 'click'
  | 'dispatch'
  | 'thunder'
  | 'collapse'
  | 'drop'
  | 'retardant'
  | 'windShift'
  | 'contained'
  | 'alert'
  | 'torch'
  | 'burnover'
  | 'win'
  | 'lose';

export interface AmbienceLevels {
  /** Wind speed in m/s. */
  wind: number;
  /** Burning tiles near the camera (any lineage). */
  fire: number;
  /** Engines currently spraying. */
  spraying: number;
}

/**
 * Procedural audio: every sound is synthesised from oscillators and noise,
 * so the game ships no audio assets. The context is created on the first
 * user gesture (browsers block audio before one).
 */
export class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private windGain: GainNode | null = null;
  private fireGain: GainNode | null = null;
  private sprayGain: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private lastAlert = 0;
  muted: boolean;

  constructor(muted = false) {
    this.muted = muted;
  }

  /** Create the audio graph. Call from a click or key handler. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) return;
    try {
      this.ctx = new Context();
    } catch {
      this.ctx = null;
      return;
    }
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -16;
    compressor.ratio.value = 4;
    this.master.connect(compressor).connect(ctx.destination);
    this.noise = this.makeNoise(2.5);
    this.buildAmbience();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(muted ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  /** Ease the wind, fire, and hose loops toward the current scene. */
  setAmbience(levels: AmbienceLevels): void {
    const ctx = this.ctx;
    if (!ctx || !this.windGain || !this.fireGain || !this.sprayGain) return;
    const now = ctx.currentTime;
    this.windGain.gain.setTargetAtTime(Math.min(0.22, 0.03 + levels.wind * 0.016), now, 0.6);
    this.fireGain.gain.setTargetAtTime(Math.min(0.5, Math.sqrt(levels.fire) * 0.028), now, 0.4);
    this.sprayGain.gain.setTargetAtTime(Math.min(0.09, levels.spraying * 0.035), now, 0.2);
  }

  play(cue: SoundCue, delay = 0): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || this.muted) return;
    const t = ctx.currentTime + delay;
    switch (cue) {
      case 'click':
        this.tone(t, 'sine', 1250, 0.035, 0.05);
        break;
      case 'dispatch':
        for (let i = 0; i < 4; i += 1) this.tone(t + i * 0.13, 'square', i % 2 === 0 ? 720 : 960, 0.12, 0.028);
        break;
      case 'alert':
        if (t - this.lastAlert < 1.5) return;
        this.lastAlert = t;
        this.tone(t, 'square', 880, 0.08, 0.035);
        this.tone(t + 0.14, 'square', 880, 0.08, 0.035);
        break;
      case 'thunder':
        this.burst(t, { type: 'highpass', from: 2400, to: 1200 }, 0.12, 0.35, 0.002);
        this.burst(t + 0.05, { type: 'lowpass', from: 420, to: 90 }, 3.8, 0.9, 0.03);
        break;
      case 'collapse':
        this.burst(t, { type: 'lowpass', from: 300, to: 80 }, 1.6, 0.6, 0.01);
        this.tone(t, 'sine', 62, 0.7, 0.25, 38);
        break;
      case 'drop':
        this.burst(t, { type: 'bandpass', from: 1400, to: 380 }, 1.2, 0.32, 0.08);
        break;
      case 'retardant':
        this.burst(t, { type: 'bandpass', from: 700, to: 240 }, 1.8, 0.34, 0.15);
        break;
      case 'windShift':
        this.burst(t, { type: 'bandpass', from: 260, to: 1400 }, 1.8, 0.22, 0.5);
        break;
      case 'torch':
        this.burst(t, { type: 'lowpass', from: 900, to: 260 }, 0.7, 0.4, 0.04);
        break;
      case 'burnover':
        this.tone(t, 'sawtooth', 520, 0.9, 0.05, 260);
        this.burst(t, { type: 'lowpass', from: 1200, to: 200 }, 1.2, 0.4, 0.02);
        break;
      case 'contained':
        [523.25, 659.25, 783.99].forEach((f, i) => this.tone(t + i * 0.11, 'triangle', f, 0.35, 0.07));
        break;
      case 'win':
        [392, 523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.tone(t + i * 0.14, 'triangle', f, 0.9, 0.07));
        break;
      case 'lose':
        [392, 349.23, 311.13, 233.08].forEach((f, i) => this.tone(t + i * 0.22, 'triangle', f, 0.9, 0.07));
        break;
    }
  }

  private buildAmbience(): void {
    const ctx = this.ctx!;
    const master = this.master!;

    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 420;
    windFilter.Q.value = 0.7;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.09;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 220;
    lfo.connect(lfoDepth).connect(windFilter.frequency);
    lfo.start();
    this.loop(this.noise!).connect(windFilter).connect(this.windGain).connect(master);

    this.fireGain = ctx.createGain();
    this.fireGain.gain.value = 0;
    const crackleFilter = ctx.createBiquadFilter();
    crackleFilter.type = 'highpass';
    crackleFilter.frequency.value = 900;
    this.loop(this.makeCrackle(4)).connect(crackleFilter).connect(this.fireGain);
    const roarFilter = ctx.createBiquadFilter();
    roarFilter.type = 'lowpass';
    roarFilter.frequency.value = 180;
    const roarGain = ctx.createGain();
    roarGain.gain.value = 0.7;
    this.loop(this.noise!).connect(roarFilter).connect(roarGain).connect(this.fireGain);
    this.fireGain.connect(master);

    this.sprayGain = ctx.createGain();
    this.sprayGain.gain.value = 0;
    const sprayFilter = ctx.createBiquadFilter();
    sprayFilter.type = 'highpass';
    sprayFilter.frequency.value = 2600;
    this.loop(this.noise!).connect(sprayFilter).connect(this.sprayGain).connect(master);
  }

  private loop(buffer: AudioBuffer): AudioBufferSourceNode {
    const source = this.ctx!.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.start();
    return source;
  }

  private makeNoise(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  /** Sparse decaying pops over faint hiss: a campfire crackle. */
  private makeCrackle(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = (Math.random() * 2 - 1) * 0.04;
    const pops = Math.floor(seconds * 38);
    for (let p = 0; p < pops; p += 1) {
      const start = Math.floor(Math.random() * (data.length - 2000));
      const length = 120 + Math.floor(Math.random() * 900);
      const amplitude = 0.3 + Math.random() * 0.7;
      for (let i = 0; i < length; i += 1) {
        data[start + i]! += (Math.random() * 2 - 1) * amplitude * Math.exp(-i / (length * 0.22));
      }
    }
    return buffer;
  }

  private tone(t: number, type: OscillatorType, frequency: number, duration: number, volume: number, endFrequency?: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, t);
    if (endFrequency) osc.frequency.exponentialRampToValueAtTime(endFrequency, t + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(volume, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(gain).connect(this.master!);
    osc.start(t);
    osc.stop(t + duration + 0.05);
  }

  private burst(
    t: number,
    filter: { type: BiquadFilterType; from: number; to: number },
    duration: number,
    volume: number,
    attack: number,
  ): void {
    const ctx = this.ctx!;
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    source.loop = true;
    const biquad = ctx.createBiquadFilter();
    biquad.type = filter.type;
    biquad.frequency.setValueAtTime(filter.from, t);
    biquad.frequency.exponentialRampToValueAtTime(filter.to, t + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(volume, t + Math.max(0.002, attack));
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    source.connect(biquad).connect(gain).connect(this.master!);
    source.start(t);
    source.stop(t + duration + 0.05);
  }
}
