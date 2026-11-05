# Repository Guidelines

## Project

Cinderline is a browser-based low-poly wildfire command RTS. The world is a rigid terraced diorama; the simulation is deterministic per seed. Read `specs/architecture.md` before changing structure or data flow, and the relevant domain spec before changing gameplay.

## Commands

- `npm install` — install dependencies.
- `npm run dev` — Vite dev server.
- `npm run typecheck` — strict TypeScript, application and tests.
- `npm test` — Vitest unit suite.
- `npm run build` — typecheck + production bundle.
- `npm run check` — canonical local gate: typecheck, tests, build.
- `npm run smoke` — Playwright browser smoke test (uses Playwright's Chromium, a system Chrome/Chromium, or `CHROMIUM_PATH`).
- `npm run stability` — five-seed full-shift Playwright stability pass plus a determinism replay of the first seed.
- `npm run models` — screenshots of the model lab (`models.html`) to `docs/screenshots` (`OUT`, `VIEWS`, `PORT` env vars). Use it to check vehicle and building models after changing them.
- `npm run balance` — hands-off outcomes per seed (`SEEDS`, `DIFFICULTY`, `PORT` env vars); fails if a unit stalls. It runs the Vite dev server, so do not edit sources while it runs (a hot reload aborts the page).

## Structure

- `src/core/` — renderer, scene, camera rig, frame pacing/quality, model builder and shared model materials, math, RNG, local-storage preferences.
- `src/world/` — heightmap, biomes, terrain visual, roads, buildings, vegetation, hydrants.
- `src/sim/` — fire, particles, units, incidents, scenario, difficulty presets, budget.
- `src/fx/` — real-time visual feedback (lightning, threat rings, head arrows, plan preview, atmosphere). Never feeds back into the simulation.
- `src/audio/` — procedural WebAudio.
- `src/ui/` — HUD, hints, and styles.
- `src/tools/` — the model lab page (`models.html`).
- `src/test/` — headless harness for unit tests (world, fire, fleet without WebGL).
- `src/game.ts` — orchestration, input, simulation loop, test API.
- `specs/` — living design documents.
- `scripts/smoke.mjs` — end-to-end browser verification; `scripts/stability.mjs` and `scripts/balance.mjs` play full shifts; `scripts/browser.mjs` launches Chromium.

## Style

- TypeScript strict mode, ES modules, no unused locals/parameters.
- PascalCase types/interfaces/classes; camelCase functions/variables; UPPER_SNAKE_CASE constants.
- Reuse geometry/materials and prefer instancing in repeated rendering paths. Avoid per-frame allocations in hot loops.
- Build vehicles, buildings and props with `ModelBuilder` so each model stays one or two draw calls; keep them at the prop scale (1 world unit ≈ 3 m, see `specs/world.md`).
- No comments unless they explain non-obvious reasoning. Prefer small modules and explicit data shapes.
- Keep the visual language low-poly, flat-shaded, and grid-readable.

## Testing

- Add or update Vitest tests for simulation/math changes in `src/**/*.test.ts`. Use `src/test/harness.ts` to build a world and fleet headlessly.
- Gameplay state advances only in `Game.stepSimulation` at a fixed step. Anything that changes outcomes (budget, incidents, unit orders) must run there or in response to input, never from the real-time frame loop, or seeds stop replaying identically.
- Use the browser smoke test for input, dispatch, UI, road edits, and win/loss changes.
- Browser smoke runs headless SwiftShader; do not use it for FPS claims. Use a headed browser for real-GPU checks.
- Run `npm run check` before handing work over. Run `npm run smoke` for gameplay/UI changes.

## Spec hygiene

- Every gameplay or architecture change must update the relevant spec in `specs/` in the same change.
- Keep each spec's **Status** and **Outstanding** sections honest. Note what is implemented versus planned.
- If implementation must diverge from a spec, change the spec with a rationale rather than leaving an undocumented delta.

## Security and scope

- Single-player, no backend, no secrets, no external assets required at runtime.
- Do not add network calls, analytics, or third-party trackers without explicit approval.
- Keep the app buildable as static files.
