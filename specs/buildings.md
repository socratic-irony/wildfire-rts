# Buildings & Lots Spec (v0.2)

## Status

Implemented in `src/buildings/buildings.ts` and `src/buildings/visual.ts`.

- Road-adjacent houses and barns are generated from local road tangents and
  outward frontage normals. Their orientation points the local +Z/front axis
  toward a real road tile.
- Every building declares a rectangular grid footprint, a deterministic
  variant, and a driveway entrance. Road-facing lots connect to a road tile;
  isolated cabins intentionally have no driveway ribbon.
- Footprints are validated against terrain slope, non-buildable fuel, roads,
  and a one-cell clearance ring. The same ring is reserved between buildings,
  so structures do not touch or overlap.
- `BuildingsVisual` keeps instanced low-poly batches for house, barn, and cabin
  walls/roofs, plus shared instanced details for doors, windows, porches,
  chimneys, and terrain-hugging driveway strips. House variants use hip or
  gable roof batches; barns and cabins use full-footprint gable roofs.
  Fire-state tinting and the existing fire/scoring state machine remain intact.
- Placement and rendering use tile centers in `(x,z)` and `Heightmap.sample`
  for world elevation; no per-frame geometry allocation is introduced.

## API and behavior

`Building` retains `id`, `kind`, `tile`, and `state`, and adds:

- `footprint: { width, depth }`: cell dimensions, with width along the local
  road tangent and depth along the local front axis.
- Footprint dimensions are odd in both axes so the integer `tile` remains the
  geometric center used by both occupancy validation and the rendered box.
- `orientation`: radians; local `+Z` points to the entrance/driveway.
- `variant`: deterministic low-poly silhouette/material variation within a
  building kind.
- `driveway: { entrance, road }`: grid points. `road` is a road tile for
  frontage lots and `null` for isolated cabins.

`buildingFootprintCells(building)` is the shared pure helper for enumerating
the oriented grid cells covered by a footprint. `generateBuildings` uses it
for placement validation and tests use it to verify non-overlap and clearance.

The latching state machine remains:

`intact → burning` when the anchor tile is hot; `burning → destroyed` when the
tile is burned through; `burning → intact` when suppressed before burn-through.
`computeStructureScore` remains +10 per intact/burning structure and −25 per
destroyed structure.

## Outstanding work

- Buildings still use procedural low-poly geometry; authored meshes and richer
  interior/side-facing window layouts are outside this stage.
- Cabins remain intentionally isolated and do not render long forest driveway
  ribbons. A future access-road system can add those connections without
  changing the footprint or fire-state contracts.
- Driveway centerlines begin at the visible porch/door front, use sampled
  terrain heights at each segment endpoint, and terminate at the declared road
  tile.
- The browser audit should continue to include a screenshot inspection after
  any change to the camera, terrain, or building palette.
