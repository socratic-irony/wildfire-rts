import { getLogger } from '../../tools/logging/index.js';

type Ticker = (dt: number, elapsed: number) => void;

export class Loop {
  private last = performance.now();
  private elapsed = 0;
  private raf = 0;
  private tickers: Ticker[] = [];
  private logger = getLogger();
  private frameCount = 0;
  private running = false;

  add(t: Ticker) { this.tickers.push(t); }
  remove(t: Ticker) { this.tickers = this.tickers.filter(x => x !== t); }

  start() { 
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.logger.info('Main loop started');
    this.raf = requestAnimationFrame(this.frame); 
  }
  
  stop() { 
    if (!this.running) return;
    this.running = false;
    this.logger.info('Main loop stopped');
    cancelAnimationFrame(this.raf); 
  }

  step(ms: number) {
    const dt = Math.min(0.05, Math.max(0, ms) / 1000);
    this.last += dt * 1000;
    this.tick(dt);
  }

  getElapsed() {
    return this.elapsed;
  }

  private tick(dt: number) {
    this.elapsed += dt;
    
    // Log performance metrics periodically (every 5 seconds)
    this.frameCount++;
    if (this.frameCount % 300 === 0 && dt > 0) {
      const fps = Math.round(1 / dt);
      this.logger.debug('Performance metrics', {
        fps,
        frameTime: (dt * 1000).toFixed(2) + 'ms',
        tickers: this.tickers.length,
        elapsed: this.elapsed.toFixed(1) + 's'
      });
    }
    
    for (const t of this.tickers) t(dt, this.elapsed);
  }

  private frame = (now: number) => {
    if (!this.running) return;
    const dt = Math.max(0, Math.min(0.05, (now - this.last) / 1000));
    this.last = now;
    this.tick(dt);
    this.raf = requestAnimationFrame(this.frame);
  };
}
