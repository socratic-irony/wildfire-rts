import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

/** System Chromium builds tried when Playwright's own download is missing. */
const FALLBACK_EXECUTABLES = [
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  '/opt/pw-browsers/chromium',
];

/**
 * Launch headless Chromium. `CHROMIUM_PATH` overrides the executable. If the
 * Playwright-managed browser is not installed, fall back to a system build.
 */
export async function launchChromium(options = {}) {
  const override = process.env.CHROMIUM_PATH;
  if (override) return chromium.launch({ headless: true, ...options, executablePath: override });
  try {
    return await chromium.launch({ headless: true, ...options });
  } catch (error) {
    const fallback = FALLBACK_EXECUTABLES.find((path) => existsSync(path));
    if (!fallback || !/Executable doesn't exist/i.test(String(error))) throw error;
    console.warn(`Playwright browser not installed; using ${fallback}. Set CHROMIUM_PATH to choose another.`);
    return chromium.launch({ headless: true, ...options, executablePath: fallback });
  }
}
