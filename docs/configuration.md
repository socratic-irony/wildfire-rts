# Configuration System

The Wildfire RTS project uses a centralized configuration system with support for environment overrides and feature flags. This system allows for flexible configuration management without touching core gameplay code.

## Configuration Files

### Schema Definition
The configuration schema is defined in `config/schema.json` and provides:
- Type validation for all configuration options
- Default value definitions
- Documentation for each configuration option

### Default Configuration
`config/default.json` contains the default values for all configuration options. This file should never be modified directly.

### Local Configuration
Create `config/local.json` (based on `config/local.example.json`) to override specific configuration values for local development. This file is ignored by git.

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

Configuration values can be overridden using environment variables with the format:
```
WF_<SECTION>_<KEY>=<value>
```

Examples:
```bash
WF_LOGGING_VERBOSITY=debug
WF_DEBUG_SHOWSTATS=false
WF_RENDERING_ANTIALIAS=false
WF_FEATURES_ENABLEEXPERIMENTALFEATURES=true
```

## Usage

### Loading Configuration
```typescript
import { loadConfig, ConfigLoader } from './tools/config';

// Load configuration with defaults and overrides
const { config, errors } = await loadConfig({
  allowEnvironmentOverrides: true,
  throwOnValidationErrors: false
});

// Or use the loader class
const loader = new ConfigLoader();
const config = await loader.load();
```

### Using the Logger
The configurable logger demonstrates feature flag usage:

```typescript
import { ConfigurableLogger } from './tools/logger';

const logger = new ConfigurableLogger(config.logging);

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
if (config.features.enableExperimentalFeatures) {
  // Enable experimental functionality
}

if (config.logging.enablePerformanceLogs) {
  // Log performance metrics
}
```

## Validation

The configuration system includes comprehensive validation:
- Type checking for all values
- Enum validation for restricted values (like verbosity levels)
- Range validation for numeric values
- Detailed error reporting with paths and descriptions

## Integration

The configuration system is designed to integrate cleanly with the existing Vite/TypeScript build system and follows the project's coding standards:
- TypeScript with strict mode
- ES modules
- Consistent naming conventions
- Comprehensive testing with Vitest

## Testing

Unit tests are provided for:
- Configuration validation
- Configuration loading and merging
- Logger functionality and feature flags
- Environment variable parsing

Run tests with:
```bash
npm run test
```

## Best Practices

1. **Never modify default.json directly** - Use local.json or environment variables for overrides
2. **Use feature flags for non-critical paths** - Don't gate core gameplay behind feature flags
3. **Validate configuration early** - Load and validate config at application startup
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