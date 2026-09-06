# World fidelity and gameplay diagnosis

## Baseline

Inspected 2026-09-05 at `757a0f21e9b02f21e452bea255c4ad892cf56983`.
Fetching origin confirms a clean main checkout, 54 commits ahead and zero behind.
Strict type checking, 66 test files / 280 tests, and production build pass.
Browser audit is being checked separately; static gates do not establish visual quality.

## Findings

1. `src/vehicles/voxelMeshes.ts` deliberately builds chunky box-based bodies. Four civilian styles and named animated equipment exist; the missing fidelity is silhouette, glazing, body shaping, and equipment detail. Preserve shared resources, merged static parts, and named animation hooks.
2. `src/roads/visual.ts` uses uniform asphalt, dashed white center lines, dusty shoulders, and gray circular intersection markers. There are no stop signs. Improve rural two-lane presentation, edge/center markings and intersection treatment without changing drivable centerlines for cosmetic reasons.
3. `src/actors/trees.ts` provides two cone-derived tree families; `shrubs.ts` uses one basic shape with color/scale variation. Add visibly distinct canopy and shrub forms using bounded instanced batches, preserving fire tint and disposal.
4. `src/buildings/buildings.ts` scatters houses/barns around road cells with single-cell occupancy; `visual.ts` uses one box/cone pair for all kinds and arbitrary yaw. Add deterministic road-facing lots, footprint separation, setbacks and driveways, plus distinct buildings with windows, doors and roof forms. Keep existing fire states/scoring.
5. Hydrants are not inert: suppression receives a 1.5x coverage boost and empty trucks can refill at nearby reachable hydrants. However `updateFollowerSuppression` always consumes onboard water; the HUD omits refill/supply state. Opposite neighbors cancel in `findRoadDirection`, putting straight-road hydrants on the centerline. Refilling retains coordinates without rechecking an active source. Specs also contradict each other on offset, spacing and coverage. Verify the actual dispatched-unit path, then make active ground-unit supply explicit, visible, and removable; aircraft must not receive ground water supply.
6. `IntersectionManager` already implements full-stop, deterministic FIFO, exclusive occupancy and clearance. `PathFollower` remains on its assigned path; the prior traffic design explicitly deferred road switching. Add deterministic connected-road turn choices with continuous geometry, preserving controller ownership through the entire turn and outbound spacing. Signs must derive from the same physical intersection metadata, including T-junctions and self-crossings, excluding simple joins.
7. `ROADMAP.md` contains stale overview claims (no objective despite completed scenarios), and completed visual/traffic bullets imply more breadth than their tests establish. Record this work as a new phase with explicit acceptance rather than treating those old checkboxes as proof.

8. Atmosphere uses `FogExp2` at density 0.0045 across the scene; this is distance-based, not a literal low-altitude fog layer. The user reports overly low/dense fog and sloppy particles. Smoke systems use low initial lift and expanding sprites/meshes; compare the active flipbook and legacy particle paths before tuning. Reduce near-ground obscuration while keeping wind-driven fire columns readable.
9. The baseline browser screenshot confirms vegetation overlaps road pavement. Actor generation runs without road/building exclusion; integration must add clearance and refresh it when road/lot geometry changes, rather than only adding more plant variants.

## Selected approach

Improve the existing procedural low-poly aesthetic and Frenet architecture. Asset-pack replacement would add licensing/size concerns without fixing placement or traffic; a complete traffic rewrite would jeopardize dispatch and suppression. Use small modules and deterministic generation. Keep work in six isolated Luna tasks: vehicle fidelity; road presentation/signs; vegetation; buildings/lots; hydrant gameplay; intersection turns. Parent reviews and integrates every result, resolves overlap in specs/main/audits, and runs the combined gates.

## Acceptance

- Vehicle closeups show recognizable detailed silhouettes and preserve named FX hooks.
- Roads show coherent two-lane markings and correctly oriented roadside stop signs at controlled approaches; no floating layers or markings through junction centers.
- Multiple distinctly shaped tree/shrub families remain instanced, seeded, fire-tinted and disposable.
- Buildings face their road access, avoid roads/each other, have distinct models, and retain protection scoring.
- A real dispatched truck can draw from an active reachable hydrant beyond tank capacity; leaving coverage or removing the source restores tank use. Refilling and supply status are visible. No source means no unlimited water.
- Civilian vehicles actually change connected roads smoothly while stopping and taking turns fairly; occupancy survives transitions; no teleporting, overlap or starvation in a deterministic multi-car audit.
- Relevant specs updated with each code commit; full `npm run check` and browser audits run on the integrated checkout, with visual evidence inspected.

## Execution status

Diagnosis complete; all seven Luna tasks started successfully. The sidebar listing omitted them, but local session headers resolved their real IDs and `wait_threads` verified their state. Use the IDs below directly on future reviews; do not duplicate tasks. The missing matching Playwright Chromium was installed and the full baseline browser audit PASSED, with artifacts under `/var/folders/b3/hppdf3jn0rx_j5sfr77bqhfr0000gp/T/wildfire-rts-audit-rbciR2`. Baseline visual inspection confirms the listed shape/placement problems. New implementation acceptance remains pending.

| Scope | Task ID | Worktree | Review status |
| --- | --- | --- | --- |
| Vehicles | `01a074aa-a82d-7961-bb96-ed00b10a5860` | `/Users/main/.codex/worktrees/1ac2/wildfire-rts` | `f5d58bc` reviewed; correction requested for hubs buried within tires; screenshot path requested |
| Roads/signs | `01a074ab-8bf7-7f03-abff-67ae6a069efa` | `/Users/main/.codex/worktrees/661b/wildfire-rts` | Active |
| Vegetation | `01a074ab-9a0c-7b40-be61-b1b6e682668a` | `/Users/main/.codex/worktrees/0118/wildfire-rts` | Active; optional road/lot exclusion API requested for parent integration |
| Buildings | `01a074ab-aec5-7623-97c0-99c13bef4cbc` | `/Users/main/.codex/worktrees/7102/wildfire-rts` | Active |
| Hydrants | `01a074ab-bee4-7da3-a80e-a8f6e7b1a3e5` | `/Users/main/.codex/worktrees/4c9c/wildfire-rts` | Active; actual dispatched-unit supply acceptance emphasized |
| Turns | `01a074ab-d3af-72d0-8537-6d6077e61db9` | `/Users/main/.codex/worktrees/f7a0/wildfire-rts` | Active; task caught queue progress regression in browser audit and is fixing |
| Fog/particles | `01a074ab-df3e-7b72-9a20-98f9c635c11b` | `/Users/main/.codex/worktrees/74d3/wildfire-rts` | `e439aef` reviewed; nofx before/after screenshot improvement observed. Requested removal of hot-loop profile allocation, actual attribute tests and default-renderer verification (headless SwiftShader screenshots were black) |

Vehicle model commits integrated as `0ea35de` and `4498dee` after hub correction and closeup inspection. Integrated `npm run check` passed (283 tests). Other implementation commits remain under review. Road task received a correction request for malformed STOP glyph strokes and sign alignment; vegetation task received a draw-call reduction request (initial implementation had 23 tree + 42 shrub batches).

User reported excessive fan load during concurrent validation. Process snapshot showed Vitest at 372.5% CPU, headless Chromium GPU/renderer helpers around 46% combined, and active native preview rendering. All tasks were told to stop owned browsers/servers and heavy tests; final process check confirmed no matching project browser, audit, Vite or Vitest processes remained. Syncthing also reached ~99% CPU independently; its settings were not changed. Primary Vitest config now caps workers at two/minimum one; typecheck and diff checks pass. Future validation must use one browser slot at a time with cleanup and avoid parallel full suites across worktrees. The heartbeat includes this constraint.

Fog task verified black default rendering in headless AND native browser; nofx works. It is investigating the existing composer, code-only until granted a browser slot. Particle correction `26d70e9` removes the introduced hot-loop allocation and tests actual instance attributes; not integrated yet.

Parent heartbeat `review-luna-wildfire-implementation-tasks` continues review and integration.
