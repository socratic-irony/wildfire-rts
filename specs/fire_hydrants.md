# Fire Hydrant System Specification (v0.2)

## Status

### ✅ Implemented
- Automatic placement along rasterized road masks with a minimum spacing of **8 tiles (~16 m)** and an ideal spacing target of **10 tiles (~20 m)**
- Alternating roadside offsets sampled from the local road tangent with a **0.7 tile lateral shift** baked into `worldPos`
- Hydrant coverage radius of **25 tiles (~50 m)** enforced by `isInHydrantCoverage` and consumed by `applyWaterAoEWithHydrants`
- Suppression integration that boosts water application by **1.5× intensity** for tiles under active hydrant coverage
- Visual instancing via `HydrantVisual` that mirrors the data in `HydrantSystem`

### ⏳ Outstanding
- Gameplay tuning for coverage falloff, hydrant damage/disable states, and roadside clearance rules
- UI overlays and menubar controls for manual placement/removal beyond the debug toggle set
- Firefighter deployment hooks that differentiate between hydrant-supplied operations and limited truck tanks

## Purpose & Scope

Design a fire hydrant system that provides strategic water access points along roads for firefighter deployment and suppression operations. Fire hydrants serve as fixed infrastructure that enables firefighter units to extend their operational range beyond just firetruck hose reach.

## Core Requirements

### 1. Automatic Placement
- ✅ **Spacing**: Hydrants spawn during `updateHydrantPlacement` with an ideal spacing target of ~20 m (10 tiles) and a hard minimum of ~16 m (8 tiles)
- ✅ **Road Integration**: Placement only occurs on road-mask tiles and hydrants are culled if the underlying tile is cleared
- ⏳ **Adaptive tuning**: Future work may vary spacing based on road class or nearby structures

### 2. Coverage Areas
- ✅ **Hydrant Radius**: Each hydrant currently projects a 25 tile (~50 m) disk stored per hydrant
- ⏳ **Comparative Ranges**: Firetruck hose radius vs hydrant radius balancing is still being tuned
- ⏳ **Road Restriction**: Firefighter deployment rules using hydrant coverage remain to be wired

### 3. Suppression Integration
- ✅ **Water Source**: `applyWaterAoEWithHydrants` boosts wetness/heat knockdown by 1.5× inside coverage while honoring base logic outside
- ⏳ **Combined Coverage**: Additional stacking rules for vehicles + hydrants are planned but not yet modeled

## Data Model

```typescript
type FireHydrant = {
  id: number;
  gridPos: { x: number; z: number };    // Grid tile position
  worldPos: { x: number; z: number };   // World space position
  coverageRadius: number;               // Tiles (currently 25 for ~50 m reach)
  active: boolean;                      // Can be disabled/damaged
  waterPressure: number;                // 0..1 (future: affects spray effectiveness)
};

type HydrantSystem = {
  hydrants: FireHydrant[];
  roadMask: RoadMask;                   // Reference to road system
  nextId: number;
  minSpacingTiles: number;              // Minimum 8 tiles (~16 m) between hydrants
  idealSpacingTiles: number;            // Target 10 tiles (~20 m) at 2 m scale
};
```

## Implementation Notes

- Data lives in plain arrays (array-of-structs). Performance has been adequate; migrate to typed arrays only if profiling calls for it.
- `updateHydrantPlacement` recomputes candidates from the full road mask, then `placeHydrant` enforces minimum spacing before committing. This double check keeps legacy hydrants compatible with new spacing rules.
- Offsets alternate left/right by sampling the local road tangent (`findRoadDirection`) and shifting 0.7 tiles perpendicular before converting to meters (`cellSize`).
- `HydrantVisual` consumes `worldPos` directly, so any change to offset math must keep that contract intact.
- Suppression uses `applyWaterAoEWithHydrants`, multiplying wetness/heat knockdown by 1.5× when coverage is active and leaving off-coverage tiles at base intensity.

## Placement Algorithm

### Initial Placement
1. **Road Scan**: When roads are built, scan all road tiles
2. **Spacing Check**: For each potential location, verify minimum distance to existing hydrants
3. **Optimal Placement**: Place hydrants at regular intervals along road segments
4. **Junction Handling**: Ensure adequate coverage at road intersections

### Dynamic Updates
1. **Road Extension**: When new roads connect to existing network, add hydrants to new segments
2. **Road Removal**: Remove hydrants when underlying road tiles are destroyed
3. **Spacing Enforcement**: When roads merge, remove hydrants that violate minimum spacing

```typescript
function updateHydrantPlacement(system: HydrantSystem, newRoadTiles: Array<{x: number, z: number}>) {
  // Remove hydrants on non-road tiles
  removeInvalidHydrants(system);
  
  // Find placement candidates with proper spacing
  const candidates = findHydrantCandidates(system, newRoadTiles);
  
  // Place new hydrants
  for (const pos of candidates) {
    placeHydrant(system, pos);
  }
}
```

## Coverage Calculation

```typescript
function isInHydrantCoverage(hydrants: FireHydrant[], gridPos: {x: number, z: number}): boolean {
  return hydrants.some(h => {
    if (!h.active) return false;
    const dx = h.gridPos.x - gridPos.x;
    const dz = h.gridPos.z - gridPos.z;
    return (dx * dx + dz * dz) <= (h.coverageRadius * h.coverageRadius);
  });
}

function canDeployFirefighter(hydrants: FireHydrant[], roadMask: RoadMask, pos: {x: number, z: number}): boolean {
  // Must be on road AND within hydrant coverage
  return isRoad(roadMask, pos.x, pos.z) && isInHydrantCoverage(hydrants, pos);
}
```

## Visual Representation

### Hydrant Models
- **3D Asset**: Simple cylindrical hydrant model (~0.5m height)
- **Instanced Rendering**: Use InstancedMesh for performance with many hydrants
- **Color Coding**: 
  - Blue/silver: Active hydrant
  - Red: Inactive/damaged hydrant
  - Green highlight: When selected or in use

### Coverage Visualization
- **Coverage Circles**: Optional overlay showing hydrant range (similar to fire overlay)
- **Road Highlighting**: Highlight road segments within coverage when hydrant selected
- **Debug Mode**: Show spacing measurements and placement validation

## Integration Points

### Roads System
- **Dependency**: `src/roads/state.ts` for road mask integration
- **Events**: Hook into road building/removal events
- **Placement**: Use road pathfinding data for optimal spacing

### Fire Suppression
- **Water Source**: Extend `applyWaterAoE` to check hydrant coverage
- **Effectiveness**: Hydrants provide full water pressure (vs limited truck tanks)
- **Duration**: Unlimited spray duration from hydrants

### Vehicles/Units
- **Firefighter Units**: New unit type that requires hydrant coverage to deploy
- **Firetruck Enhancement**: Trucks provide coverage supplement, not replacement
- **Strategic Value**: Hydrants enable suppression in areas trucks cannot reach

### UI/Debug
- **Hydrant Panel**: Toggle hydrant visibility, show count and coverage statistics
- **Placement Tools**: Manual hydrant placement/removal for testing
- **Coverage Overlay**: Toggle coverage area visualization

## Performance Considerations

### Placement Optimization
- **Spatial Index**: Use grid-based lookup for fast distance queries
- **Incremental Updates**: Only recompute placement for modified road segments
- **Caching**: Cache coverage calculations for frequently queried positions

### Rendering
- **Instanced Meshes**: Single draw call for all hydrants
- **LOD**: Simplified models at distance
- **Frustum Culling**: Skip rendering off-screen hydrants

## Gameplay Balance

### Strategic Considerations
- **Infrastructure Value**: Hydrants represent valuable fixed infrastructure
- **Vulnerability**: Hydrants can be damaged by fire, requiring repair/replacement
- **Planning**: Road layout becomes strategically important for fire suppression
- **Resource Cost**: Future: hydrant installation cost vs coverage benefit

### Suppression Effectiveness
- **Range Extension**: Hydrants enable firefighting beyond truck reach
- **Water Supply**: Unlimited vs truck tank limitations
- **Coordination**: Best effectiveness when trucks and hydrants work together

## Implementation Phases

### Phase 1: Core System
- ✅ Basic hydrant data structures and placement algorithm (`createHydrantSystem`, `updateHydrantPlacement`)
- ✅ Road integration and automatic placement tied to the rasterized mask
- ✅ Instanced cylindrical visuals via `HydrantVisual`

### Phase 2: Suppression Integration
- ✅ Coverage calculation and hydrant-aware water application (`applyWaterAoEWithHydrants`)
- ⏳ Firefighter deployment rules that require hydrant coverage
- ✅ Menubar/debug actions for toggling, refreshing, and clearing hydrants

### Phase 3: Polish & Balance
- ⏳ High-fidelity hydrant models, LOD, and material polish
- ⏳ Coverage overlays, damage/pressure indicators, and roadside clearance prompts
- ⏳ Performance telemetry and large-network stress testing

## API Surface

```typescript
// Core hydrant system
function createHydrantSystem(roadMask: RoadMask): HydrantSystem;
function updateHydrants(system: HydrantSystem, dt: number): void;
function placeHydrant(system: HydrantSystem, pos: {x: number, z: number}): boolean;
function removeHydrant(system: HydrantSystem, id: number): boolean;

// Coverage queries
function findNearestHydrant(system: HydrantSystem, pos: {x: number, z: number}): FireHydrant | null;
function getHydrantCoverage(hydrant: FireHydrant): Array<{x: number, z: number}>;
function canSuppressAt(system: HydrantSystem, roadMask: RoadMask, pos: {x: number, z: number}): boolean;

// Visual integration
function createHydrantVisual(system: HydrantSystem): HydrantVisual;
function updateHydrantVisual(visual: HydrantVisual, system: HydrantSystem): void;
```

## Outstanding Questions

1. **Dynamic Pressure**: Should water pressure vary by distance from hydrant center?
2. **Network Effects**: Should connected hydrants share pressure/flow?
3. **Damage Model**: How should fire damage affect hydrant functionality?
4. **Upgrade Path**: Future support for different hydrant types (rural vs urban)?
5. **Cost Model**: Resource cost for hydrant installation in gameplay?

---

*This specification establishes fire hydrants as critical infrastructure for strategic fire suppression, extending firefighter operational range while maintaining the road-based deployment constraint.*