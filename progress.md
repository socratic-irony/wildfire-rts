Original prompt: look through the roadmap again; check the way the road renders, and maybe look around to see if there is any code duplicated anywhere; the roads are still not rendering right, so feel free to do a loop with your web game development skill / plugin to check on the road rendering

## 2026-05-04 Road Rendering Pass

- Reviewed `ROADMAP.md` and `specs/terrain.md`; roads are still documented as a prototype even though MVP items are checked.
- Visual audit screenshot confirmed the road triangle lattice is caused by always-on debug geometry in `src/roads/visual.ts`, not by the path mask or A* path itself.
- Found duplicated road planning cost logic in `src/main.ts` and `src/vehicles_test.ts`; plan is to extract shared planner logic under `src/roads/`.
- Implemented hidden-by-default road diagnostics with a detailed toolbar checkbox and extracted shared road planning into `src/roads/planner.ts`.
- Added road unit coverage for diagnostics visibility and planner endpoint stability.
- Implemented hidden-by-default hydrant coverage rings with a separate detailed toolbar toggle; hydrant markers remain visible.
- Made filled road surfaces double-sided so normal asphalt/shoulder/stripe render remains visible once the debug lattice is disabled.
- Changed `advanceTime()` to keep 50 ms deterministic simulation chunks while suppressing intermediate renders and drawing once at the end. Coarser 250 ms and 100 ms chunks were rejected because they changed vehicle/dispatch audit behavior.
