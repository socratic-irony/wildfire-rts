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
- `npm run smoke` — Playwright browser smoke test (requires `npx playwright install chromium`).
- `npm run stability` — five-seed full-shift Playwright stability pass.

## Structure

- `src/core/` — renderer, scene, camera rig, math, RNG.
- `src/world/` — heightmap, biomes, terrain visual, roads, buildings, vegetation, hydrants.
- `src/sim/` — fire, particles, units, incidents, scenario.
- `src/ui/` — HUD and styles.
- `src/game.ts` — orchestration, input, simulation loop, test API.
- `specs/` — living design documents.
- `scripts/smoke.mjs` — end-to-end browser verification.

## Style

- TypeScript strict mode, ES modules, no unused locals/parameters.
- PascalCase types/interfaces/classes; camelCase functions/variables; UPPER_SNAKE_CASE constants.
- Reuse geometry/materials and prefer instancing in repeated rendering paths. Avoid per-frame allocations in hot loops.
- No comments unless they explain non-obvious reasoning. Prefer small modules and explicit data shapes.
- Keep the visual language low-poly, flat-shaded, and grid-readable.

## Testing

- Add or update Vitest tests for simulation/math changes in `src/**/*.test.ts`.
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
