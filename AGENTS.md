# Repository Guidelines

## Project Structure & Module Organization
- Source: `src/` (TypeScript). Core engines in `src/core/` (`renderer.ts`, `scene.ts`, `camera.ts`, `input.ts`, `loop.ts`).
- Terrain: `src/terrain/` (`heightmap.ts`, `mesh.ts`, `material.ts`, `grid.ts`, `biomes.ts`).
- Actors: `src/actors/` (`trees.ts`, `shrubs.ts`, `rocks.ts`).
- UI: `src/ui/` (`debug.ts`). Entry: `src/main.ts`. Static HTML: `index.html`.
- Reference: see SPEC.md for planned interfaces and acceptance criteria.

## Build, Test, and Development Commands
- `npm install`: install dependencies (Vite + TypeScript + Three.js).
- `npm run dev`: start Vite dev server with hot reload.
- `npm run build`: production bundle to `dist/`.
- `npm run preview`: serve the built app locally.
- Tests: not yet configured. When added (Vitest recommended), use `npm run test` and place tests as noted below.

## Coding Style & Naming Conventions
- Language: TypeScript, `strict` enabled; ES modules only.
- Files: lowercase module names (e.g., `heightmap.ts`, `biomes.ts`); one module per concern.
- Types/Interfaces: `PascalCase` (e.g., `Heightmap`, `NoiseConfig`). Functions/vars: `camelCase`. Constants: `UPPER_SNAKE_CASE`.
- Rendering: reuse materials/geometry; avoid per‑frame allocations; prefer `InstancedMesh`. Keep the low‑poly aesthetic (flat shading).
- Formatting: use Prettier/ESLint if added; run before committing.

## Testing Guidelines
- Framework: Vitest (unit) + Playwright (optional e2e) are recommended.
- Location: `src/**/__tests__/*.test.ts` or colocated `*.test.ts` next to modules.
- Coverage: target critical paths (`terrain/*`, `core/*`). Add fast deterministic tests around math (noise, slope, masks).
- Example: `npx vitest run --coverage` (after tooling is added).

## Commit & Pull Request Guidelines
- Commits: concise, imperative subject; reference stage or module:
  - Example: `feat(core): add RTS camera rig` or `stage-b: terrain mesh + flat shading`.
- Scope: one logical change per commit; include brief rationale if non‑obvious.
- PRs: include description, linked issues/stages, screenshots or short video/GIF for visual changes (FPS/draw‑call note helps).
- Checks: ensure `npm run build` passes; run tests/linters if configured.

### Spec Hygiene (Required)
- Before every commit, update the relevant spec(s) in `specs/` to reflect current reality:
  - Clearly note what is working vs. not yet implemented (Status/Outstanding Work sections).
  - Align API/behavior descriptions with the code you changed.
- Do not commit code changes without bringing the corresponding spec(s) up to date.

## Security & Configuration Tips
- Keep assets lightweight; avoid committing large binaries. Prefer procedural assets per SPEC.
- Node version: use an LTS (record in `.nvmrc` if added).
- Do not block the main thread with heavy generation; precompute where possible.

## Architecture Overview
- Core composes renderer/scene/camera/input/loop; terrain builds a chunked mesh; actors use instancing; UI exposes debug toggles. Follow SPEC.md stages A→G when implementing.
