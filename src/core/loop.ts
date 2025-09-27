import { getLogger } from '../../tools/logging/index.js';

type Ticker = (dt: number, elapsed: number) => void;

export class Loop {
  private last = performance.now();
  private elapsed = 0;
  private raf = 0;
  private tickers: Ticker[] = [];
  private logger = getLogger();
  private frameCount = 0;

  add(t: Ticker) { this.tickers.push(t); }
  remove(t: Ticker) { this.tickers = this.tickers.filter(x => x !== t); }

  start() { 
    this.logger.info('Main loop started');
    this.raf = requestAnimationFrame(this.frame); 
  }
  
  stop() { 
    this.logger.info('Main loop stopped');
    cancelAnimationFrame(this.raf); 
  }

  private frame = (now: number) => {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.elapsed += dt;
    
    // Log performance metrics periodically (every 5 seconds)
    this.frameCount++;
    if (this.frameCount % 300 === 0) {
      const fps = Math.round(1 / dt);
      this.logger.debug('Performance metrics', {
        fps,
        frameTime: (dt * 1000).toFixed(2) + 'ms',
        tickers: this.tickers.length,
        elapsed: this.elapsed.toFixed(1) + 's'
      });
    }
    
    for (const t of this.tickers) t(dt, this.elapsed);
    this.raf = requestAnimationFrame(this.frame);
  };
}

