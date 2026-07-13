# Road Traffic Reliability Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make generated roads, visible road-following vehicles, and all-way-stop intersections deterministic, collision-resistant, observable, and browser-verified.

**Architecture:** Preserve smoothed `RoadsVisual` midlines and visible `PathFollower` vehicles. Consolidate traffic arbitration in `IntersectionManager`, fix closed-loop spacing in a pure helper, and expose deterministic traffic diagnostics through the existing browser API.

**Tech Stack:** TypeScript, Three.js, Vitest, Vite, Playwright

---

### Task 1: Characterize intersection and closed-loop defects

**Files:**
- Create: `src/vehicles/__tests__/intersectionManager.test.ts`
- Create: `src/vehicles/__tests__/trafficSpacing.test.ts`
- Create: `src/vehicles/trafficSpacing.ts`

**Steps:**

1. Write failing tests for a follower approaching an intersection on the low-`s` side of a closed loop, deterministic simultaneous-arrival FIFO, blocked exit, clearance release, and leader gaps across a loop seam.
2. Run `npx vitest run src/vehicles/__tests__/intersectionManager.test.ts src/vehicles/__tests__/trafficSpacing.test.ts` and confirm failures are caused by the missing behavior.
3. Implement only the distance/state and leader-assignment behavior needed by the tests.
4. Re-run the focused tests and the complete Vitest suite.

### Task 2: Stabilize intersection geometry metadata

**Files:**
- Modify: `src/roads/visual.ts`
- Create: `src/roads/__tests__/intersections.test.ts`

**Steps:**

1. Write failing tests for one stable self-intersection on a figure-eight and one stable cross-path intersection without adjacent-segment endpoint noise.
2. Run the focused road test and confirm the incorrect count/metadata.
3. Deduplicate near-identical crossings and expose compact intersection diagnostics.
4. Re-run focused and complete tests.

### Task 3: Integrate the shared traffic controller

**Files:**
- Modify: `src/vehicles/intersectionManager.ts`
- Modify: `src/vehicles/frenet.ts`
- Modify: `src/main.ts`
- Modify: `src/vehicles/__tests__/yield.test.ts`

**Steps:**

1. Add failing tests for braking-envelope caps, traffic phases, and stable external cap expiry.
2. Add manager telemetry, deterministic tie-breaking, safe circular distance handling, and minimum-stop/clearance behavior.
3. Replace ad-hoc same-path leader assignment with the tested closed-loop spacing helper.
4. Expand the spillback probe to all visible ground followers near the intersection exit.
5. Add a conservative right-hand lane offset for road vehicles.
6. Re-run focused tests, the suite, and the build.

### Task 4: Eliminate the live WebGL shader failure

**Files:**
- Modify: `src/particles/ribbon.ts`
- Create: `src/__tests__/ribbon_shader.test.ts`

**Steps:**

1. Write a failing material-compilation-hook test proving injected UV animation has no declarations.
2. Declare the uniforms/varying or guard the UV injection behind UV support.
3. Run the focused test and build.
4. Run a browser smoke test and confirm there are no shader compilation errors.

### Task 5: Add deterministic traffic browser coverage

**Files:**
- Modify: `src/main.ts`
- Modify: `scripts/qa/playwright_audit.ts`
- Modify: `src/__tests__/simple_barrier_test.test.ts` only if baseline logging obscures failures (no behavior change)

**Steps:**

1. Extend `buildGameState` with intersection count, queues, occupant IDs, traffic phase, and per-path follower spacing.
2. Add test API setup for a deterministic crossing-road traffic scenario.
3. Add an audit scenario that verifies stop, queue, single occupancy, fairness/progress, and collision-free separation over time.
4. Make the audit collect page and WebGL errors and fail on new errors.
5. Run the shared web-game Playwright client after each meaningful integration change and inspect text state plus screenshots.
6. Run the full repository audit and inspect baseline, contention, and cleared-intersection screenshots.

### Task 6: Align specifications and verify release quality

**Files:**
- Modify: `specs/architecture.md`
- Modify: `specs/driving.md`
- Modify: `specs/vehicles.md`
- Modify: `progress.md`

**Steps:**

1. Update Status, API, testing, and outstanding-work sections to match the implementation.
2. Run `npm run test`, `npm run build`, and `npm run audit:game` fresh.
3. Inspect all final screenshots and console logs.
4. Review `git diff --check`, `git diff --stat`, and the complete diff for unintended changes.
