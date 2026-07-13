# Standalone Configuration Example

This document describes the maintained example schema under `config/` and loader under `tools/config/`. It is type-checked and unit-tested, but it is not the configuration source used by the game entry point.

The live browser runtime uses the small in-memory flag store in `src/config/features.ts`. Its keys are `features.debug_overlay`, `features.console_commands`, `features.advanced_metrics`, and the related `debug.*` snake-case settings. `src/main.ts` currently reads `console_commands` from that store. Do not pass the camel-case schema below to `src/config/features.ts`; the two surfaces are intentionally distinct until an explicit integration replaces one of them.

## Configuration Files

### Schema Definition
`config/schema.json` documents the intended types, defaults, and descriptions for the example configuration. The current hand-written validator does not consume this file.

### Default Configuration
`config/default.json` contains the default values for all configuration options. This file should never be modified directly.

### Local Configuration Example
`config/local.example.json` illustrates a possible local override. The current `tools/config/loader.ts` has a placeholder `loadLocalConfig()` that returns an empty object, so copying it to `config/local.json` does not currently affect either the standalone loader or the game runtime.

## Configuration Sections

### Logging
Controls logging behavior and verbosity:
- `verbosity`: Log level (`silent`, `error`, `warn`, `info`, `debug`, `verbose`)
- `enableConsoleTimestamps`: Add timestamps to console output
- `enablePerformanceLogs`: Enable performance metric logging

### Debug
Debug-related features:
- `showStats`: Show debug statistics panel
- `enableGridOverlay`: Enable terrain grid overlay by default
- `enableWireframe`: Render wireframe view

### Rendering
Rendering configuration:
- `antialias`: Enable antialiasing
- `shadows`: Enable shadow rendering
- `maxPixelRatio`: Maximum pixel ratio for high-DPI displays (1-3)

### Features
Feature flag toggles:
- `enableExperimentalFeatures`: Enable experimental features (may be unstable)

## Environment Variable Overrides

The standalone loader scans environment variables with the format:
```
WF_<SECTION>_<KEY>=<value>
```

Examples:
```bash
WF_LOGGING_VERBOSITY=debug
```

The current parser lowercases the property token and does not translate it back to camelCase, so `WF_LOGGING_VERBOSITY` works but camel-case keys such as `showStats` are not reliably overridable yet. This limitation does not affect `src/config/features.ts`, which does not read environment variables.

## Usage

### Loading the Standalone Example
```typescript
import { loadConfig, ConfigLoader } from './tools/config';

// Load the tools/config example with defaults and environment overrides
const { config: loadedConfig, errors } = await loadConfig({
  allowEnvironmentOverrides: true,
  throwOnValidationErrors: false
});

// Or use the loader class
const loader = new ConfigLoader();
const cachedConfig = await loader.load();
```

### Using the Matching Example Logger
`tools/logger.ts` is the companion `ConfigurableLogger` example for this schema. It is not the runtime logger imported by `src/main.ts`:

```typescript
import { ConfigurableLogger } from './tools/logger';

const logger = new ConfigurableLogger(loadedConfig.logging);

// These respect the verbosity setting
logger.debug('Debug message');
logger.info('Info message');
logger.warn('Warning message');
logger.error('Error message');

// Performance logging (feature flag controlled)
logger.performance('operation-name', 42.5, 'ms');

// Time functions automatically
const result = logger.timeFunction('expensive-operation', () => {
  // Some expensive operation
  return computeResult();
});
```

### Feature Flag Pattern
Feature flags should be used for non-critical functionality:

```typescript
if (loadedConfig.features.enableExperimentalFeatures) {
  // Enable experimental functionality
}

if (loadedConfig.logging.enablePerformanceLogs) {
  // Log performance metrics
}
```

## Validation

The hand-written validator provides focused checks for recognized keys that are present:
- Primitive types for recognized logging, debug, rendering, and feature keys
- The logging `verbosity` enum
- The `rendering.maxPixelRatio` range (1–3)
- Error paths, messages, and offending values

It does not consume `config/schema.json`, require sections or keys, or reject unknown sections or keys. The schema is documentation until explicit schema-based validation is implemented.

## Integration

The standalone example is maintained by the TypeScript and source-graph gates, but application startup does not call `loadConfig`. Integrating it would require an explicit migration from `src/config/features.ts`, including compatibility tests for the existing runtime keys. It follows the project's coding standards:
- TypeScript with strict mode
- ES modules
- Consistent naming conventions
- Focused testing with Vitest

## Testing

Unit tests are provided for:
- Recognized-key validation, verbosity values, and pixel-ratio bounds
- Default loading plus `ConfigLoader` cache/error access
- The companion `ConfigurableLogger` verbosity, timestamps, performance logging, timing, and runtime updates

Run the canonical repository gate with:
```bash
npm run check
```

## Best Practices

1. **Treat this as a standalone example** - Runtime feature changes belong in `src/config/features.ts` unless an integration is deliberately implemented
2. **Use feature flags for non-critical paths** - Don't gate core gameplay behind feature flags
3. **Validate before consuming the example** - Check loader errors before a standalone tool uses the returned configuration
4. **Document new configuration options** - Update the schema and this documentation
5. **Test configuration changes** - Add tests for new validation rules or features

## File Structure
```
config/
├── schema.json          # JSON schema definition
├── default.json         # Default configuration values
└── local.example.json   # Example local overrides

tools/config/
├── index.ts            # Main exports
├── types.ts            # TypeScript interfaces
├── loader.ts           # Configuration loader
└── validator.ts        # Configuration validation

tools/
└── logger.ts           # Configurable logger implementation
```

The separate live logger is under `tools/logging/`; see `docs/logging.md`.
