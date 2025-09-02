# Debug Overlay Touch Map

This document tracks all files affected by the debug overlay and console system implementation.

## Purpose

Document all files touched during the implementation of issue #5 (Build Developer Debug Overlay and In-Engine Console) to maintain clear understanding of system dependencies and avoid coupling issues.

## Files Created

### Core Debug System
- `src/config/features.ts` - Feature flag configuration system
- `src/ui/console.ts` - Command console implementation
- `docs/debug-tools.md` - User documentation for debug tools
- `docs/buckets/debug-overlay.md` - This touch map document

### Tests
- `src/__tests__/config.test.ts` - Tests for configuration system
- `src/__tests__/console.test.ts` - Tests for console functionality

## Files Modified

### Existing Debug System
- `src/ui/debug.ts` - Enhanced with memory metrics and feature flag support
- `src/main.ts` - Integrated config system and console

### Documentation Updates
- `specs/architecture.md` - Updated to reflect new debug capabilities

## Coupling Analysis

### Safe Dependencies
The debug system safely depends on:
- Core rendering system (`renderer`, `scene`, `camera`)  
- Terrain system (`heightmap`, `chunks`)
- Fire system (for ignite commands and stats)
- Road system (for construction/clearing)

### Avoided Coupling
Per issue requirements, we avoid coupling to:
- Vehicle system internals (only uses public API)
- Particle system (not directly coupled)
- Rendering pipeline internals (uses provided renderer info)

### Architecture Principles
- Debug overlay is optional and can be disabled via feature flags
- Console commands provide read-only introspection where possible
- No debug code in hot paths that could impact performance
- All debug features can be stripped in production builds

## Integration Points

### Main Application (`src/main.ts`)
- Config system initialization
- Debug overlay setup with feature flag check
- Console integration with keyboard handlers

### UI Components
- Debug overlay: self-contained module with minimal dependencies
- Console: standalone component with command registration system

### Configuration System (`src/config/features.ts`)
- Central feature flag management  
- Type-safe configuration access
- Runtime configuration updates

## Testing Strategy

### Unit Tests
- Configuration system behavior
- Console command parsing
- Memory metric calculation

### Integration Tests  
- Debug overlay toggling
- Console command execution
- Feature flag integration

## Performance Considerations

- Memory metrics calculated only when debug overlay visible
- Console commands executed asynchronously to avoid blocking
- Debug drawing/overlays use efficient rendering techniques
- Feature flags allow complete debug system removal

## Future Extensions

### Planned Enhancements
- Export debug session data
- Custom command plugin system  
- Remote debug interface
- Performance profiling tools

### Extension Points
- Command registration system for new debug commands
- Metric collection system for custom performance counters
- Plugin architecture for domain-specific debug tools