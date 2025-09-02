import { Vector2, Vector3, Raycaster, Camera, Object3D } from 'three';
import { FireGrid } from '../fire/grid';
import { applyWaterAoE, applyRetardantLine } from '../fire/grid';
import { Heightmap } from '../terrain/heightmap';
import type { ToolMode } from './menubar';

export type PaintSystemHandle = {
  update: (dt: number) => void;
  setCurrentTool: (tool: ToolMode) => void;
  getCurrentTool: () => ToolMode;
  setEnabled: (enabled: boolean) => void;
  isEnabled: () => boolean;
};

export function createPaintSystem(
  canvas: HTMLCanvasElement,
  camera: Camera,
  terrain: Object3D,
  heightmap: Heightmap,
  fireGrid: FireGrid
): PaintSystemHandle {
  let currentTool: ToolMode = 'none';
  let enabled = true;
  let isMouseDown = false;
  let lastPaintPos: { x: number; z: number } | null = null;
  
  const raycaster = new Raycaster();
  const mouse = new Vector2();
  
  // Paint settings
  const PAINT_SETTINGS = {
    water: {
      radius: 2.0,      // Grid units
      intensity: 0.4,   // Per application
      interval: 0.05,   // Seconds between applications when dragging
    },
    retardant: {
      radius: 1.5,      // Grid units
      intensity: 0.6,   // Per application
      interval: 0.08,   // Seconds between applications when dragging
    },
  };
  
  let paintTimer = 0;

  // Convert screen coordinates to world position on terrain
  const screenToTerrain = (screenX: number, screenY: number): { x: number; z: number } | null => {
    const rect = canvas.getBoundingClientRect();
    mouse.x = ((screenX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((screenY - rect.top) / rect.height) * 2 + 1;
    
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObject(terrain, true);
    
    if (intersects.length > 0) {
      const point = intersects[0].point;
      // Convert to grid coordinates
      const gridX = point.x / heightmap.scale;
      const gridZ = point.z / heightmap.scale;
      
      // Clamp to valid grid bounds
      const clampedX = Math.max(0, Math.min(fireGrid.width - 1, gridX));
      const clampedZ = Math.max(0, Math.min(fireGrid.height - 1, gridZ));
      
      return { x: clampedX, z: clampedZ };
    }
    
    return null;
  };

  // Apply paint at position
  const applyPaint = (tool: ToolMode, pos: { x: number; z: number }) => {
    switch (tool) {
      case 'water':
        applyWaterAoE(fireGrid, pos, PAINT_SETTINGS.water.radius, PAINT_SETTINGS.water.intensity);
        console.log(`Applied water at (${pos.x.toFixed(1)}, ${pos.z.toFixed(1)}) radius=${PAINT_SETTINGS.water.radius}`);
        break;
      
      case 'retardant':
        // For retardant, we'll build a small line if we have a previous position
        if (lastPaintPos && Math.hypot(pos.x - lastPaintPos.x, pos.z - lastPaintPos.z) > 0.1) {
          // Create a short line from last position to current
          const polyline = [lastPaintPos, pos];
          applyRetardantLine(fireGrid, polyline, PAINT_SETTINGS.retardant.radius, PAINT_SETTINGS.retardant.intensity);
          console.log(`Applied retardant line from (${lastPaintPos.x.toFixed(1)}, ${lastPaintPos.z.toFixed(1)}) to (${pos.x.toFixed(1)}, ${pos.z.toFixed(1)})`);
        } else {
          // Single point application
          applyWaterAoE(fireGrid, pos, PAINT_SETTINGS.retardant.radius, 0); // Use water function for circular area
          const i = Math.floor(pos.z) * fireGrid.width + Math.floor(pos.x);
          if (i >= 0 && i < fireGrid.tiles.length) {
            fireGrid.tiles[i].retardant = Math.max(fireGrid.tiles[i].retardant, PAINT_SETTINGS.retardant.intensity);
            console.log(`Applied retardant at (${pos.x.toFixed(1)}, ${pos.z.toFixed(1)}) radius=${PAINT_SETTINGS.retardant.radius}`);
          }
        }
        break;
    }
  };

  // Mouse event handlers
  const onMouseDown = (event: MouseEvent) => {
    if (!enabled || (currentTool !== 'water' && currentTool !== 'retardant')) return;
    
    event.preventDefault();
    isMouseDown = true;
    paintTimer = 0; // Reset timer to allow immediate paint
    
    const pos = screenToTerrain(event.clientX, event.clientY);
    if (pos) {
      applyPaint(currentTool, pos);
      lastPaintPos = pos;
    }
  };

  const onMouseMove = (event: MouseEvent) => {
    if (!enabled || !isMouseDown || (currentTool !== 'water' && currentTool !== 'retardant')) return;
    
    const pos = screenToTerrain(event.clientX, event.clientY);
    if (pos) {
      // Only paint if enough time has passed (to avoid spamming)
      const settings = currentTool === 'water' ? PAINT_SETTINGS.water : PAINT_SETTINGS.retardant;
      if (paintTimer <= 0) {
        applyPaint(currentTool, pos);
        lastPaintPos = pos;
        paintTimer = settings.interval;
      }
    }
  };

  const onMouseUp = (event: MouseEvent) => {
    if (!enabled) return;
    
    isMouseDown = false;
    lastPaintPos = null;
  };

  // Attach event listeners
  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mouseup', onMouseUp);
  
  // Also handle mouse leaving the canvas
  canvas.addEventListener('mouseleave', onMouseUp);

  // Cursor management
  const updateCursor = () => {
    if (!enabled) {
      canvas.style.cursor = 'default';
      return;
    }

    switch (currentTool) {
      case 'water':
        canvas.style.cursor = 'crosshair';
        break;
      case 'retardant':
        canvas.style.cursor = 'crosshair'; 
        break;
      case 'ignite':
        canvas.style.cursor = 'crosshair';
        break;
      case 'roads':
        canvas.style.cursor = 'crosshair';
        break;
      default:
        canvas.style.cursor = 'default';
    }
  };

  return {
    update(dt: number) {
      if (paintTimer > 0) {
        paintTimer -= dt;
      }
    },
    
    setCurrentTool(tool: ToolMode) {
      currentTool = tool;
      updateCursor();
      // Reset painting state when switching tools
      isMouseDown = false;
      lastPaintPos = null;
    },
    
    getCurrentTool() {
      return currentTool;
    },
    
    setEnabled(newEnabled: boolean) {
      enabled = newEnabled;
      if (!enabled) {
        isMouseDown = false;
        lastPaintPos = null;
      }
      updateCursor();
    },
    
    isEnabled() {
      return enabled;
    }
  };
}