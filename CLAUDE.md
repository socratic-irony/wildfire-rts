# CLAUDE.md

Entry-point for Claude Code sessions in this repo. General contribution rules live in [AGENTS.md](AGENTS.md); this file is the short version plus the rules unique to how we use the automated audit loop.

## Reading order

1. [ROADMAP.md](ROADMAP.md) — what we're building next and how it's phased.
2. [CHANGELOG.md](CHANGELOG.md) — what shipped recently; useful session context.
3. [AGENTS.md](AGENTS.md) — commit hygiene, spec-first development.
4. [specs/architecture.md](specs/architecture.md) — module map and runtime model.
5. Whichever domain spec under [specs/](specs/) matches the change you're making.

## Mandatory checks before claiming work is done

Run all three, in order. Any red = not done.

```bash
npm run check            # Strict type-check, complete Vitest suite, then Vite build
npm run validate-assets  # Repository asset rules
npm run audit:game       # Deterministic Playwright audit against the live dev server
```

For fast compiler-only feedback, run `npm run typecheck`. `npm run build` runs Vite bundling only; it does not invoke `tsc` and must not be used as evidence that the source graph type-checks.

The audit launches its own dev server via [scripts/qa/playwright_audit.ts](scripts/qa/playwright_audit.ts) and writes screenshots to a temp dir (or `$GAME_AUDIT_ARTIFACTS` if set). Inspect the screenshots when a scenario fails — they catch visual regressions the assertions miss.

## Audit-scenario-first rule

When adding or changing a gameplay claim (dispatch, payload, suppression, new vehicle ability, new win condition, etc.):

1. **First** add a scenario in [scripts/qa/playwright_audit.ts](scripts/qa/playwright_audit.ts) that asserts the claim. Watch it fail.
2. Then implement the minimum to make it pass.
3. Update the relevant [specs/](specs/) `Status` section.
4. Tick the checkbox in [ROADMAP.md](ROADMAP.md) and append a one-liner to [CHANGELOG.md](CHANGELOG.md).

Scripted `window.__wildfireTestApi` helpers (declared in [src/main.ts](src/main.ts)) are the primary driver surface: `advanceTime`, `igniteTile`, `spawnVehicle`, `orderFollowerTo`, `applyWaterAt`, `manualDispatch`, `setAutoDispatch`, etc. Prefer extending the test API over clicking through the UI — scenarios must be deterministic under `advanceTime`.

## Things that bite

- `advanceTime(ms)` steps the loop in 50ms deterministic chunks. The RAF path has been fixed to tolerate this, but if you add a new frame-driven system, make sure negative / zero `dt` is a no-op.
- `Object3D.getWorldPosition(target)` requires `target` to be a real `THREE.Vector3` (internally calls `target.setFromMatrixPosition`). Plain `{x,y,z}` objects crash on the first call.
- Newly spawned followers must have `updateMatrixWorld(true)` called before any immediate order or state read — otherwise their position reads as `(0,0,0)`.
- Dispatch only marks an incident `assigned` if at least one unit's path projects within 12 m of the incident tile — manual UI code must route first, assign second.

## Scope discipline

- Don't add features, refactor, or introduce abstractions beyond what the task requires.
- Don't touch deferred items in [ROADMAP.md](ROADMAP.md) (OSM import, fire-aware pathing, crown fire) without an explicit ask.
- Keep commits focused per [AGENTS.md](AGENTS.md); every commit updates the matching spec.
