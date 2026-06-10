import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

/**
 * Quick wall-clock probe of simulation/update cost: times advanceTime(30s)
 * which steps the full game loop (fire sim, dispatch, visual overlay
 * updates) in 50 ms chunks with rendering suppressed, then times 300
 * real rendered frames via rAF. Not a benchmark — a before/after sanity
 * check for performance passes.
 */
async function main() {
  const url = process.env.GAME_AUDIT_URL ?? 'http://127.0.0.1:4173';
  let server: ReturnType<typeof spawn> | null = null;
  if (!process.env.GAME_AUDIT_URL) {
    server = spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '4173'], { stdio: 'ignore' });
    await new Promise((r) => setTimeout(r, 3000));
  }
  const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);

  // Ignite a few fires so fire-dependent systems have work to do.
  await page.evaluate(() => {
    const api = (window as any).__wildfireTestApi;
    api.igniteTile(64, 64, 0.9);
    api.igniteTile(40, 80, 0.9);
    api.igniteTile(80, 40, 0.9);
    api.advanceTime(5_000); // let fire develop
  });

  const simMs = await page.evaluate(() => {
    const api = (window as any).__wildfireTestApi;
    const t0 = performance.now();
    api.advanceTime(30_000);
    return performance.now() - t0;
  });

  const frameMs = await page.evaluate(async () => {
    const frames = 300;
    const t0 = performance.now();
    for (let i = 0; i < frames; i++) {
      await new Promise(requestAnimationFrame);
    }
    return (performance.now() - t0) / frames;
  });

  console.log(`advanceTime(30s): ${simMs.toFixed(0)} ms wall (${(simMs / 600).toFixed(2)} ms per 50ms step)`);
  console.log(`rendered frame avg: ${frameMs.toFixed(2)} ms (${(1000 / frameMs).toFixed(0)} fps, software GL)`);

  await browser.close();
  server?.kill('SIGTERM');
}

main().catch((e) => { console.error(e); process.exit(1); });
