# Repository Cleanup Design

## Goal

Reduce dead code, accidental duplication, and maintenance friction without changing documented application or testbed behavior. Every production-facing refactor must be protected by an existing behavioral test or a new characterization test, and the repository must keep passing its build and browser-level verification gates.

## Compatibility Boundary

- Preserve the main application, vehicle testbed, particle testbed, and model viewer entry points.
- Preserve documented exports and the dual vehicle architecture described in `specs/vehicles.md`.
- Remove undocumented exports only when repository-wide reference analysis proves they are unused.
- Remove private members, local variables, imports, and helpers when TypeScript analysis proves they are unused.
- Do not redesign gameplay, alter tuning, or retire the documented grid-agent vehicle system in this pass.
- Leave pre-existing user files and unrelated worktree changes untouched.

## Approaches Considered

### Mechanical cleanup only

Enable stricter compiler checks and remove reported unused code. This is very low risk, but it would leave larger structural problems and duplicated orchestration unexamined.

### Broad architectural rewrite

Split `main.ts`, `ui/menubar.ts`, `vehicles/vehicles.ts`, and `roads/visual.ts` into new subsystems in one pass. This could improve structure quickly, but it creates too much behavioral and rendering risk for a compatibility-focused cleanup.

### Phased characterization-driven cleanup

First make static-analysis findings enforceable, then remove proven dead code, then add characterization tests around duplication before extracting shared helpers. This provides useful cleanup while keeping each change small, reviewable, and reversible. This is the selected approach.

## Design

### Verification layers

The cleanup uses four independent gates:

1. TypeScript compilation with unused locals and parameters enabled.
2. The complete Vitest suite, including new characterization tests.
3. The Vite production build.
4. The Playwright game audit for browser/runtime behavior when touched code can affect the live application.

Coverage is diagnostic rather than a sufficient gate: currently excluded rendering and UI modules must not be treated as tested merely because aggregate coverage is high.

### Dead-code removal

Start with compiler-proven unused imports, locals, private fields, and private methods. For exported symbols and whole files, require both an import-graph check and a repository-wide reference check. Documented demo/testbed surfaces are compatibility surfaces even when they are not imported by the main application.

Removing a private implementation detail does not warrant an artificial unit test for the deleted line itself. Instead, the containing module must have a behavioral or characterization test, and the stricter type-check command becomes the regression test that prevents equivalent dead code from returning.

### Redundancy and helper extraction

Only extract helpers where two or more active call sites implement the same policy. Write tests against the desired shared boundary before changing call sites. Prefer pure helpers for math, mapping, routing, and state transitions. Avoid abstractions that merely reduce line count while hiding lifecycle or rendering order.

### Large modules

Large files are audit targets, not automatic split targets. Extract a seam only when it has a coherent responsibility, a narrow data contract, and test coverage that can pin existing behavior. Runtime wiring order remains owned by `main.ts`; UI assembly remains owned by the relevant UI module unless a tested pure helper can be separated.

### Test quality

Remove unused test imports and incidental console output. Add focused tests for uncovered logic that is changed during cleanup. Tests should assert observable state or returned values rather than implementation details. Browser-only rendering behavior remains covered by the existing audit rather than brittle DOM or Three.js mocks.

## Risks and Controls

- Tree-shaking can hide dead code from the production bundle while leaving it in source. The stricter type-check gate catches local/private cases, and graph analysis handles module-level cases.
- Exported APIs can have consumers outside the repository. Documented exports are therefore preserved; undocumented exports are removed only with explicit evidence.
- Rendering and simulation code may be order-sensitive. Any extraction that changes initialization or update order is out of scope.
- Existing tests emit expected console noise. Cleanup may silence incidental test output, but production error reporting behavior must remain unchanged.

## Success Criteria

- No TypeScript unused-local or unused-parameter diagnostics remain under the enforced repository command.
- Every changed behavior-bearing module is protected by an existing or new focused test.
- No documented entry point or API is removed.
- The complete unit suite, production build, and relevant browser audit pass after the final changes.
- Relevant architecture/domain specs accurately describe completed cleanup and remaining structural debt.
