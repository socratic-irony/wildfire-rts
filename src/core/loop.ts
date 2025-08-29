export type Ticker = (dt: number, elapsed: number) => void;

export class Loop {
  private last = performance.now();
  private elapsed = 0;
  private raf = 0;
  private tickers: Ticker[] = [];

  add(t: Ticker) { this.tickers.push(t); }
  remove(t: Ticker) { this.tickers = this.tickers.filter(x => x !== t); }

  start() { this.raf = requestAnimationFrame(this.frame); }
  stop() { cancelAnimationFrame(this.raf); }

  private frame = (now: number) => {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.elapsed += dt;
    for (const t of this.tickers) t(dt, this.elapsed);
    this.raf = requestAnimationFrame(this.frame);
  };
}

