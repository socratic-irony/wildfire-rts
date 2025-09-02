# Debug Tools

The wildfire RTS engine provides a comprehensive debug overlay and command console system for development and introspection.

## Debug Overlay

The debug overlay displays real-time metrics and provides interactive controls for development. It can be toggled with the `F1` key or controlled via the feature flag system.

### Metrics Displayed

- **Frame Rate**: Current FPS
- **Render Stats**: Draw calls, triangles rendered
- **Memory Usage**: Heap size, used memory, available memory (when available)
- **Terrain**: Chunk count, LOD distribution (high/low detail)
- **Instances**: Tree count (conifer + broadleaf), shrub count, rock count
- **System**: Performance timing information

### Interactive Controls

- **Fire System**: Ignite mode toggle, ignite center action, visualization mode selection
- **Roads**: Toggle road placement mode, clear all roads
- **Vehicles**: Spawn vehicles, toggle movement mode, clear all vehicles
- **Configuration**: Follow mode selection, spacing mode, yaw debug options

### Feature Flag Integration

The debug overlay can be controlled via the config system:

```typescript
import { config } from './config/features';

// Check if debug overlay is enabled
if (config.features.debug_overlay) {
  // Debug overlay will be shown
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