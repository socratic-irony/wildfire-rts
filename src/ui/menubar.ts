import { config } from '../config/features';

// Simple icon system using Unicode/emoji and basic shapes
const ICONS = {
  fire: '🔥',
  water: '💧', 
  retardant: '🧪',
  road: '🛣️',
  vehicle: '🚗',
  terrain: '🏔️',
  stats: '📊',
  settings: '⚙️',
  eye: '👁️',
  eyeOff: '👁️‍🗨️',
  play: '▶️',
  pause: '⏸️',
  clear: '🗑️',
} as const;

export type ToolMode = 
  | 'ignite' 
  | 'water' 
  | 'retardant' 
  | 'roads' 
  | 'none';

export type MenubarHandle = {
  setVisible: (visible: boolean) => void;
  isVisible: () => boolean;
  getCurrentTool: () => ToolMode;
  setActions: (actions: MenubarActions) => void;
};

export type MenubarActions = {
  fire?: {
    ignite?: () => void;
    igniteCenter?: () => void;
    setVizMode?: (mode: 'overlay' | 'raised' | 'vertex') => void;
    applyWater?: (x: number, z: number, radius: number) => void;
    applyRetardant?: (x: number, z: number, radius: number) => void;
  };
  roads?: {
    toggle?: (on: boolean) => void;
    clear?: () => void;
  };
  vehicles?: {
    spawn?: () => void;
    moveModeToggle?: (on: boolean) => void;
    clear?: () => void;
  };
  stats?: {
    toggleOverlay?: () => void;
  };
};

export function createMenubar(container: HTMLElement): MenubarHandle {
  let visible = config.debug.overlay_visible_on_start;
  let currentTool: ToolMode = 'none';
  let actions: MenubarActions = {};

  // Create menubar container
  const menubar = document.createElement('div');
  menubar.style.cssText = `
    position: absolute;
    top: 12px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(0, 0, 0, 0.8);
    backdrop-filter: blur(4px);
    border-radius: 8px;
    padding: 8px 12px;
    display: flex;
    gap: 4px;
    align-items: center;
    font-family: system-ui, sans-serif;
    font-size: 14px;
    color: #e5e7eb;
    pointer-events: auto;
    z-index: 1000;
  `;

  container.appendChild(menubar);

  // Helper to create tool buttons
  const createToolButton = (icon: string, label: string, tool: ToolMode) => {
    const btn = document.createElement('button');
    btn.style.cssText = `
      background: rgba(55, 65, 81, 0.8);
      border: 1px solid rgba(75, 85, 99, 0.8);
      border-radius: 6px;
      padding: 6px 10px;
      color: #e5e7eb;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 12px;
      transition: all 0.2s ease;
    `;
    
    btn.innerHTML = `<span style="font-size: 14px;">${icon}</span><span>${label}</span>`;
    btn.title = label;
    
    btn.addEventListener('mouseenter', () => {
      btn.style.background = 'rgba(75, 85, 99, 0.9)';
      btn.style.borderColor = 'rgba(107, 114, 128, 0.9)';
    });
    
    btn.addEventListener('mouseleave', () => {
      if (currentTool !== tool) {
        btn.style.background = 'rgba(55, 65, 81, 0.8)';
        btn.style.borderColor = 'rgba(75, 85, 99, 0.8)';
      }
    });

    btn.addEventListener('click', () => {
      // Toggle tool or activate
      if (currentTool === tool) {
        setCurrentTool('none');
      } else {
        setCurrentTool(tool);
      }
    });

    return btn;
  };

  // Helper to create action buttons (non-tool buttons)
  const createActionButton = (icon: string, label: string, action: () => void) => {
    const btn = document.createElement('button');
    btn.style.cssText = `
      background: rgba(55, 65, 81, 0.8);
      border: 1px solid rgba(75, 85, 99, 0.8);
      border-radius: 6px;
      padding: 6px 10px;
      color: #e5e7eb;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 12px;
      transition: all 0.2s ease;
    `;
    
    btn.innerHTML = `<span style="font-size: 14px;">${icon}</span><span>${label}</span>`;
    btn.title = label;
    
    btn.addEventListener('mouseenter', () => {
      btn.style.background = 'rgba(75, 85, 99, 0.9)';
      btn.style.borderColor = 'rgba(107, 114, 128, 0.9)';
    });
    
    btn.addEventListener('mouseleave', () => {
      btn.style.background = 'rgba(55, 65, 81, 0.8)';
      btn.style.borderColor = 'rgba(75, 85, 99, 0.8)';
    });

    btn.addEventListener('click', action);
    return btn;
  };

  // Helper to create separator
  const createSeparator = () => {
    const sep = document.createElement('div');
    sep.style.cssText = `
      width: 1px;
      height: 24px;
      background: rgba(75, 85, 99, 0.6);
      margin: 0 4px;
    `;
    return sep;
  };

  // Create tool buttons
  const igniteBtn = createToolButton(ICONS.fire, 'Ignite', 'ignite');
  const waterBtn = createToolButton(ICONS.water, 'Water', 'water');
  const retardantBtn = createToolButton(ICONS.retardant, 'Retardant', 'retardant');
  const roadsBtn = createToolButton(ICONS.road, 'Roads', 'roads');

  // Create action buttons
  const igniteCenterBtn = createActionButton(ICONS.fire, 'Center', () => actions.fire?.igniteCenter?.());
  const clearRoadsBtn = createActionButton(ICONS.clear, 'Clear', () => actions.roads?.clear?.());
  const spawnVehicleBtn = createActionButton(ICONS.vehicle, 'Spawn', () => actions.vehicles?.spawn?.());
  const clearVehiclesBtn = createActionButton(ICONS.clear, 'Clear', () => actions.vehicles?.clear?.());
  const statsBtn = createActionButton(ICONS.stats, 'Stats', () => actions.stats?.toggleOverlay?.());

  // Build menubar layout
  menubar.appendChild(igniteBtn);
  menubar.appendChild(igniteCenterBtn);
  menubar.appendChild(createSeparator());
  menubar.appendChild(waterBtn);
  menubar.appendChild(retardantBtn);
  menubar.appendChild(createSeparator());
  menubar.appendChild(roadsBtn);
  menubar.appendChild(clearRoadsBtn);
  menubar.appendChild(createSeparator());
  menubar.appendChild(spawnVehicleBtn);
  menubar.appendChild(clearVehiclesBtn);
  menubar.appendChild(createSeparator());
  menubar.appendChild(statsBtn);

  // Current tool indicator
  const toolIndicator = document.createElement('div');
  toolIndicator.style.cssText = `
    margin-left: 8px;
    padding: 4px 8px;
    background: rgba(59, 130, 246, 0.2);
    border: 1px solid rgba(59, 130, 246, 0.4);
    border-radius: 4px;
    font-size: 11px;
    color: #93c5fd;
  `;
  menubar.appendChild(toolIndicator);

  // Function to update current tool
  const setCurrentTool = (tool: ToolMode) => {
    currentTool = tool;
    
    // Update button styles
    [igniteBtn, waterBtn, retardantBtn, roadsBtn].forEach(btn => {
      btn.style.background = 'rgba(55, 65, 81, 0.8)';
      btn.style.borderColor = 'rgba(75, 85, 99, 0.8)';
    });

    // Highlight active tool
    let activeBtn: HTMLButtonElement | null = null;
    switch (tool) {
      case 'ignite': activeBtn = igniteBtn; break;
      case 'water': activeBtn = waterBtn; break;
      case 'retardant': activeBtn = retardantBtn; break;
      case 'roads': activeBtn = roadsBtn; break;
    }

    if (activeBtn) {
      activeBtn.style.background = 'rgba(59, 130, 246, 0.3)';
      activeBtn.style.borderColor = 'rgba(59, 130, 246, 0.6)';
    }

    // Update indicator
    toolIndicator.textContent = tool === 'none' ? 'No tool selected' : `Active: ${tool}`;
    
    // Handle tool-specific actions
    if (tool === 'roads') {
      actions.roads?.toggle?.(true);
    } else {
      actions.roads?.toggle?.(false);
    }
  };

  // Initialize with no tool
  setCurrentTool('none');

  // Set initial visibility
  menubar.style.display = visible ? 'flex' : 'none';

  // Toggle with F1
  window.addEventListener('keydown', (e) => {
    if ((e.key === 'F1' || e.key === 'f1') && config.features.debug_overlay) {
      visible = !visible;
      menubar.style.display = visible ? 'flex' : 'none';
      e.preventDefault();
    }
  });

  return {
    setVisible(vis: boolean) {
      visible = vis;
      menubar.style.display = visible ? 'flex' : 'none';
    },
    isVisible() {
      return visible;
    },
    getCurrentTool() {
      return currentTool;
    },
    setActions(newActions: MenubarActions) {
      actions = newActions;
    }
  };
}