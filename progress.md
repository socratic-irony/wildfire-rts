Original prompt: I've been having a hell of a time getting the roads to generate and render correctly; and getting cars to follow them, and getting intersections to work, and cars to queue / take turns at intersections and so on; I want you to check over what's there and develop all that for me; don't ask any questions; use your best judgment and implement and test repeatedly; take screenshots and interactive tests etc. and reflect and iterate until it's production ready and flawless

## 2026-07-12 Audit

- Read `AGENTS.md`, `specs/architecture.md`, `specs/driving.md`, and `specs/vehicles.md`.
- Baseline: `npm run test` passes 209 tests; `npm run build` passes.
- Baseline browser audit exposes repeated invalid WebGL shader programs from `src/particles/ribbon.ts` (`vUv`, `uTime`, and `uSpeed` undeclared).
- Baseline screenshot visually confirms road ribbons render, but traffic behavior is not covered by the audit.
- Root traffic defects identified: incorrect closed-loop intersection clearance math, insufficient braking envelope, no seam leader, and same-path-only exit probing.

## TODO

- No known road/traffic correctness blockers remain.
- Future: directed lane graph and explicit left/through/right route choice across road components.

## 2026-07-12 Implementation

- Added deterministic batch arbitration in `IntersectionManager`: braking envelope, full-stop timer, FIFO by stop time/follower ID, one occupant, blocked-exit probe, and closed-loop-safe clearance.
- Added `assignPathLeaders` so closed-loop seam vehicles maintain the same following gap as every other pair.
- Deduplicated physical road intersections while retaining both arc occurrences of self-crossing paths and excluding simple endpoint joins.
- Added `Path2D.projectAll` so self-crossing occurrences survive conversion from rendered midlines to follower paths.
- Added right-side lane offset, road-surface clearance, late vehicle render order, and an above-road/depth-independent yield ring; this fixed asphalt hiding visible car bodies.
- Fixed invalid fire-ribbon WebGL shader injection by declaring/using dedicated uniforms and UV varying.
- Added `?scenario=traffic`, `setupTrafficScenario`, queue/occupant/phase/min-gap telemetry, and a four-car Playwright traffic audit.
- Focused traffic audit passes: all four cars receive occupancy, queue drains, minimum same-path gap stays ≥1.9 m, transforms remain finite, and cars do not overlap.
- Shared web-game client and headed Chromium runs visually inspected. One intermediate screenshot can show black vertical bands under software WebGL readback; adjacent frames and headed state are clean, confirming a capture artifact rather than scene corruption.
- Current verification: 60 Vitest files / 239 tests pass; `npm run check` covers strict `tsc --noEmit`, the full suite, and the production build.
- Full 18-scenario Playwright audit passes, including the new traffic intersection scenario and all pre-existing dispatch/fire/vehicle regressions.
- Full-audit review caught a stale manual-dispatch button after follower selection. Routeability was true; the dispatch DOM was waiting for its 5 Hz refresh. Test-API and real canvas selections now synchronously refresh dispatch actions, and the isolated plus full audits pass.
- Final contention capture waits for two actual `queued` phases and visibly shows both gold stop rings. Clearance remains asserted from state because long SwiftShader fast-forward readbacks can show transient black bands that are absent from adjacent live frames.

## 2026-07-12 Road Surface Visual Follow-up

- Screenshot review exposed a remaining presentation defect: cars appeared submerged and the road showed a variable-thickness side band over hills.
- Root cause was structural, not vehicle altitude: `RoadsVisual` rendered two vertically separated filled asphalt ribbons while the production overlays bypassed depth testing.
- Removed the redundant baseline ribbon and made the single named `road-surface`, shoulders, and center stripe depth-tested. The optional diagnostic wireframe now reuses the production geometry and remains hidden by default.
- Added a regression test requiring exactly one named, depth-tested, depth-writing production road surface.
- Headed interactive traffic captures in `artifacts/web-game/road-surface-fix/` confirm complete car bodies render above the asphalt and the false side thickness is gone; captured state shows intersection occupancy rotating between queued cars without console errors.
- Final focused `traffic-intersection` Playwright audit passes and its contention capture was visually inspected after the surface fix.

## 2026-07-12 Repository Maintenance Follow-up

- Added strict unused-local/parameter enforcement and the canonical `npm run typecheck` / `npm run check` gates; Vite's production build remains a separate bundling step and does not type-check by itself.
- Added a source-graph test that treats the documented app, testbeds, scripts, tests, and standalone config/logging examples as roots, then removed the unreachable dispatch station prototype it exposed.
- Consolidated the repeated actor LCG, nearest-cell coordinate conversion, and water-suppression tile loop behind characterized helpers while preserving existing sequences, rounding, clamping, and suppression semantics.
- Confirmed that the four terrain-regeneration `updateTerrain` methods are live call points. Flipbook particles fully swap their sampled heightmap; the ribbon, suppression decals, and fire visualization still have partial compatibility behavior documented as outstanding work in the fire/particle specs.
- Removed incidental success/debug output from barrier and terrain-regeneration tests without weakening existing assertions, and added two barrier setup assertions for retardant and line strength. Intentional logger-sink and expected-warning tests still emit through their tested channels.
- Final verification: `npm run check` passes 60 files / 239 tests and the 76-module production build; asset validation accepts 9/9 assets with six advisory oversized-image warnings; all 18 Playwright audit scenarios pass.

## 2026-09-06 Visual artifact follow-up

- User screenshots reproduced three render defects: suppression decals were created with `depthTest: false`, procedural building meshes requested vertex colors without a white geometry color attribute (so lit materials rendered black), and stop signs used the left-hand lateral offset while their support poles intersected the sign faces.
- Fixed decal depth testing in the main scene, added white base color attributes to procedural building geometries, corrected stop-sign right-side placement, brightened/explicitly opaque metal poles, and offset poles behind the sign board.
- Added focused regressions for all three paths. Full `npm run audit:game` passes all 19 scenarios; fresh baseline, aircraft, buildings, and traffic screenshots were inspected. No audit Chromium/Vite/test workers remain; the user-facing dev server on port 5173 remains running.
