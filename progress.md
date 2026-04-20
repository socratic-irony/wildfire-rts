Original prompt: [$develop-web-game](/Users/main/.codex/skills/develop-web-game/SKILL.md) we need to work on this game a lot, it has a lot of little glitches and bugs, and even things written as done on the roadmap are not actually working, thoroughly test this against the roadmap features

2026-04-19
- Audit started against `ROADMAP.md` plus `specs/terrain.md`, `specs/fire_behavior.md`, `specs/vehicles.md`, and `specs/fire_hydrants.md`.
- First gap found: the app did not expose `window.render_game_to_text` or `window.advanceTime`, which blocked deterministic browser validation.
- Next: add audit hooks, run baseline build/tests, then execute Playwright scenarios for fire, roads, hydrants, vehicles, and dispatch flows.
- Baseline verification passed after instrumentation: `npm run build` and `npm test` both green; browser audit confirmed terrain/roads/hydrants/fire/dispatch all load in the live build.
- Added `window.__wildfireTestApi` for deterministic browser scenarios (`getState`, road creation/clearing, vehicle spawning/selection, direct fire/suppression actions, hydrant refresh, auto-dispatch toggle).
- Fixed text-state follower positions to report real world coordinates instead of `(0,0,0)`.
- Fixed road-endpoint bookkeeping so successful road placement keeps only the last endpoint for chaining instead of growing an unbounded history.
- Fixed dispatch incident resolution so cooled smoldering tiles resolve incidents and release assigned vehicles; added regression coverage in `src/dispatch/__tests__/incident.test.ts`.
- UI polish pass: removed the redundant controls banner from `index.html`, tightened the toolbar footprint, and added stable `data-testid` hooks for the core toolbar controls.
- Remaining follow-up worth testing next: bulldozer off-road orders, manual unit selection/dispatch from the panel, and longer-run fast-forward performance of `advanceTime()` for multi-minute scenarios.
- Added `npm run audit:game` backed by `scripts/qa/playwright_audit.ts`. The audit now covers seeded world bootstrap, road build/clear, bulldozer off-road orders, suppression tools, auto-dispatch resolution, and manual dispatch.
- Fixed `Loop` negative-dt behavior after `advanceTime()` fast-forwards; the RAF path no longer cancels out simulated time.
- Fixed newly spawned followers to update world transforms immediately so instant orders/state reads are accurate; bulldozers now respond correctly to immediate off-road orders.
- Improved dispatch panel UX by disabling "Assign selected" when the selected unit cannot actually service the incident from its current road, instead of presenting a button that silently fails.
- New practical MVP baseline: unit tests pass, build passes, and `npm run audit:game` passes.
