# Debug Tools

The wildfire RTS engine provides a unified debug toolbar and command console system for development and introspection.

## Unified Debug Toolbar

The debug interface has been unified into a single, comprehensive toolbar that eliminates competing overlays. The toolbar displays real-time metrics and provides interactive controls for development. It can be toggled with the `F1` key or controlled via the feature flag system.

### Main Toolbar Features

- **Emoji-based tool buttons**: Intuitive icons for quick access to tools
  - 🔥 **Ignite/Fire**: Toggle ignite mode or ignite at center
  - 💧 **Water**: Apply water for fire suppression
  - 🧪 **Retardant**: Apply fire retardant
  - 🛣️ **Roads**: Toggle road placement mode
  - 🚗 **Spawn**: Spawn vehicles
  - 🗑️ **Clear**: Clear roads or vehicles
- **Real-time performance stats**: FPS, memory usage, draw calls, instance counts displayed inline
- **Settings button** (⚙️): Expands detailed configuration panels

### Performance Metrics Displayed

- **Frame Rate**: Current FPS
- **Render Stats**: Draw calls, triangles rendered  
- **Memory Usage**: Heap size, used memory, available memory (when available)
- **Terrain**: Chunk count, LOD distribution (high/low detail)
- **Instances**: Tree count (conifer + broadleaf), shrub count, rock count

### Runtime Logging Integration

The application now includes strategic logging for better runtime visibility:

- **Main Loop Performance**: Logs FPS, frame time, and tickers count every 5 seconds
- **Fire Simulation**: Logs burning/igniting tile counts and wind conditions every second  
- **Application Lifecycle**: Logs startup and initialization events
- **Configurable Levels**: Adjust logging verbosity via `config/logging.json`

To view logs in the browser console:
```typescript
import { getLogger } from '../tools/logging/index.js';
const logger = getLogger();
logger.info('Custom log message', { data: 'structured logging supported' });
```

### Expandable Controls

Click the ⚙️ settings button to access detailed configuration panels for:

- **🔥 Fire System**: Fire visualization mode, ribbon controls, fire statistics
- **🚗 Vehicles**: Movement controls, path following modes, debug options  
- **🏔️ Terrain**: World generation parameters, biome settings, regeneration controls

### Feature Flag Integration

The unified toolbar can be controlled via the config system:

```typescript
import { config } from './config/features';

// Check if debug overlay is enabled
if (config.features.debug_overlay) {
  // Unified debug toolbar will be shown
}
```

## Command Console

The command console provides a text-based interface for advanced introspection and debugging commands.

### Opening the Console

- Press `` ` `` (backtick) to open/close the console
- Press `Escape` to close the console

### Available Commands

#### System Commands
- `help` - Show all available commands
- `clear` - Clear the console output
- `config [key] [value]` - Get or set configuration values

#### Fire System Commands  
- `fire.ignite <x> <z>` - Ignite fire at grid coordinates
- `fire.stats` - Display fire simulation statistics
- `fire.clear` - Extinguish all fires

#### Terrain Commands
- `terrain.info <x> <z>` - Get terrain information at coordinates
- `terrain.elevation <x> <z>` - Get elevation at world coordinates

#### Vehicle Commands (when available)
- `vehicles.spawn <x> <z>` - Spawn vehicle at grid coordinates
- `vehicles.count` - Display current vehicle count
- `vehicles.clear` - Remove all vehicles

#### Performance Commands
- `perf.memory` - Display detailed memory usage
- `perf.render` - Display render performance stats

### Command History

The console maintains a history of executed commands. Use the up/down arrow keys to navigate through previously entered commands.

## Configuration

Debug tools can be configured via the feature flag system:

```typescript
// Enable/disable debug overlay
config.features.debug_overlay = true;

// Configure default visibility
config.debug.overlay_visible_on_start = false;

// Configure console access
config.debug.console_enabled = true;