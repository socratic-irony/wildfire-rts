# Repository Cleanup Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove proven dead code and genuine duplication, expand regression coverage, and add enforceable repository hygiene checks without changing documented runtime behavior.

**Architecture:** Preserve the current entry points and dual vehicle system. Add compiler and source-graph gates first, then use their failures to drive dead-code removal; use focused characterization tests before shared-helper extraction; keep initialization and render/update ordering unchanged.

**Tech Stack:** TypeScript 5, Vite 5, Vitest 1, Three.js, Playwright audit scripts.

---

### Task 1: Enforce clean TypeScript and remove compiler-proven debris

**Files:**
- Modify: `package.json`
- Modify: `tsconfig.json`
- Modify: `src/main.ts`
- Modify: `src/core/rtsOrbit.ts`
- Modify: `src/actors/rocks.ts`
- Modify: `src/fire/decals.ts`
- Modify: `src/fire/grid.ts`
- Modify: `src/fire/overlay.ts`
- Modify: `src/fire/sim.ts`
- Modify: `src/fire/viz.ts`
- Modify: `src/particle_testbed.ts`
- Modify: `src/particles/fireParticles.ts`
- Modify: `src/particles/flipbook.ts`
- Modify: `src/particles/system.ts`
- Modify: `src/roads/visual.ts`
- Modify: `src/terrain/chunks.ts`
- Modify: `src/ui/debug.ts`
- Modify: `src/ui/menubar.ts`
- Modify: `src/ui/paint.ts`
- Modify: `src/vehicles/frenet.ts`
- Modify: `src/vehicles/vehicles.ts`
- Modify: `src/vehicles_test.ts`
- Modify: `tools/config/validator.ts`
- Modify: affected tests under `src/__tests__/`
- Modify: `specs/architecture.md`
- Modify: `specs/vehicles.md`

**Step 1: Add the failing quality gate**

Add `noUnusedLocals` and `noUnusedParameters` to `tsconfig.json`, add `typecheck: tsc --noEmit`, and add `check: npm run typecheck && npm test && npm run build` to `package.json`.

**Step 2: Run the gate and verify the expected failure**

Run: `npm run typecheck`

Expected: FAIL with the current unused imports, locals, parameters, private fields, and private methods.

**Step 3: Remove only compiler-proven dead code**

- Delete unused imports and locals.
- Keep compatible callback/factory signatures by prefixing intentionally unused public parameters with `_`.
- Delete the unused `VehiclesManager` speed fields and disconnected grid-intersection queue implementation, including the associated `Agent` fields and stale spec claims.
- Remove incidental unused test imports without changing assertions.
- Do not reorder initialization, render passes, or simulation updates.

**Step 4: Verify the gate and behavior suite**

Run: `npm run typecheck`

Expected: PASS with zero diagnostics.

Run: `npm test`

Expected: all tests pass.

Run: `npm run build`

Expected: production bundle succeeds.

**Step 5: Update specs and commit**

Record the enforced quality gate in `specs/architecture.md` and correct `specs/vehicles.md` so it no longer claims the removed, unreachable grid-intersection queue is active.

Commit: `chore: enforce clean TypeScript sources`

### Task 2: Make orphan modules detectable and remove the abandoned station registry

**Files:**
- Create: `src/__tests__/source_graph.test.ts`
- Delete: `src/dispatch/stations.ts`
- Modify: `specs/architecture.md`

**Step 1: Write the failing repository graph test**

Use the TypeScript preprocessor to resolve relative imports for all repository `.ts` files. Treat the three HTML-backed application/testbed modules, QA/asset scripts, test files, `vite.config.ts`, and explicitly documented standalone config/logging demo modules as roots. Assert that every other TypeScript file is reachable from one of those roots.

**Step 2: Verify the expected failure**

Run: `npx vitest run src/__tests__/source_graph.test.ts`

Expected: FAIL listing `src/dispatch/stations.ts` as unreachable.

**Step 3: Remove the orphan module**

Delete `src/dispatch/stations.ts`. Do not remove documented config/logging demo surfaces.

**Step 4: Verify the graph and full suite**

Run: `npx vitest run src/__tests__/source_graph.test.ts`

Expected: PASS.

Run: `npm run check`

Expected: type-check, unit tests, and build all pass.

**Step 5: Update the architecture status and commit**

Document the new graph test and the removed unreferenced station prototype.

Commit: `test: prevent orphaned source modules`

### Task 3: Consolidate deterministic scatter and coordinate conversion helpers

**Files:**
- Create: `src/core/random.ts`
- Create: `src/core/__tests__/random.test.ts`
- Create: `src/terrain/coordinates.ts`
- Create: `src/terrain/__tests__/coordinates.test.ts`
- Modify: `src/actors/rocks.ts`
- Modify: `src/actors/shrubs.ts`
- Modify: `src/actors/trees.ts`
- Modify: `src/main.ts`
- Modify: `src/vehicles_test.ts`
- Modify: `specs/architecture.md`
- Modify: `specs/terrain.md`

**Step 1: Add characterization tests**

- Pin the existing LCG sequence for a fixed seed and verify independent generators do not share state.
- Pin world-to-grid rounding and boundary clamping for negative, interior, and beyond-edge coordinates.

**Step 2: Verify characterization coverage**

Run: `npx vitest run src/core/__tests__/random.test.ts src/terrain/__tests__/coordinates.test.ts`

Expected: tests pass against the extracted pure helpers before changing call sites.

**Step 3: Replace active duplication**

- Replace the three byte-for-byte actor LCG implementations with `createLcg(seed)`.
- Replace repeated `round(world / scale)` plus clamp blocks in `main.ts` and `vehicles_test.ts` with `worldToGridCell`.
- Preserve exact rounding, bounds, seed constants, and generated sequences.

**Step 4: Verify focused and full behavior**

Run: `npx vitest run src/core/__tests__/random.test.ts src/terrain/__tests__/coordinates.test.ts src/__tests__/biomes.test.ts src/__tests__/terrain_regeneration.test.ts`

Expected: PASS.

Run: `npm run check`

Expected: PASS.

**Step 5: Update specs and commit**

Document the shared deterministic scatter and coordinate conversion helpers.

Commit: `refactor(core): share deterministic utility helpers`

### Task 4: Consolidate suppression semantics and remove unused factory hooks

**Files:**
- Modify: `src/fire/grid.ts`
- Modify: `src/__tests__/hydrants.test.ts`
- Create: `src/__tests__/visual_factory_surfaces.test.ts`
- Modify: `src/fire/decals.ts`
- Modify: `src/fire/viz.ts`
- Modify: `src/particles/flipbook.ts`
- Modify: `specs/fire_behavior.md`
- Modify: `specs/particles.md`

**Step 1: Add suppression characterization coverage**

Build two identical grids, apply `applyWaterAoE` to one and `applyWaterAoEWithHydrants(..., undefined)` to the other, and assert equal wetness, heat, and state for every tile. Cover an edge-clipped radius and burning/smoldering tiles.

**Step 2: Add the failing public-surface test**

Instantiate the suppression decal, fire visualization, and flipbook particle factories. Assert their supported method keys and omit the repository-unreferenced `updateTerrain` hooks.

Run: `npx vitest run src/__tests__/visual_factory_surfaces.test.ts`

Expected: FAIL because the unused hooks are still present.

**Step 3: Extract the shared water application loop**

Create one private radius iterator/application helper in `src/fire/grid.ts`. Keep both exported wrappers and their exact intensity semantics; the hydrant wrapper supplies the per-tile multiplier while the base wrapper supplies the original constant intensity.

**Step 4: Remove unsupported factory hooks**

Delete the two no-op visualization/decal hooks and the unused flipbook terrain reassignment hook. Preserve all active factory methods and runtime call order.

**Step 5: Verify focused and full behavior**

Run: `npx vitest run src/__tests__/hydrants.test.ts src/__tests__/follower_suppression.test.ts src/__tests__/visual_factory_surfaces.test.ts src/__tests__/particles_flipbook.test.ts`

Expected: PASS.

Run: `npm run check`

Expected: PASS.

**Step 6: Update specs and commit**

Document the shared suppression core and the supported factory surfaces.

Commit: `refactor(fire): consolidate suppression helpers`

### Task 5: Reconcile documentation, quiet incidental test output, and run final audits

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`
- Modify: `progress.md`
- Modify: `docs/ci.md`
- Modify: `docs/configuration.md`
- Modify: `docs/logging.md`
- Modify: noisy tests under `src/__tests__/`
- Modify: relevant files under `specs/`

**Step 1: Remove incidental test output**

Delete success/debug `console.log` calls from tests where assertions already express the result. Keep tests that intentionally verify logging behavior and expected error channels.

**Step 2: Reconcile command and architecture documentation**

- Document `npm run typecheck` and `npm run check` as the canonical local gates.
- Correct stale claims that Vite build itself type-checks.
- Correct the old test count and intersection-system descriptions.
- Explicitly distinguish the runtime feature flags/logger from the separately documented configuration/logger examples instead of pretending they are one schema.

**Step 3: Run the complete local gate**

Run: `npm run check`

Expected: zero TypeScript diagnostics, all unit tests pass without incidental debug output, and the production build succeeds.

**Step 4: Run repository-specific verification**

Run: `npm run validate-assets`

Expected: asset validation succeeds.

Run: `npm run audit:game`

Expected: all deterministic browser audit scenarios pass without runtime or WebGL errors.

**Step 5: Inspect final repository state and commit**

Run: `git diff --check`, inspect `git diff --stat`, and confirm the untracked user-owned `play.command` remains untouched.

Update each touched spec's Status/Outstanding Work section to match the final code.

Commit: `docs: reconcile repository maintenance guidance`
