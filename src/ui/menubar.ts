import { config } from '../config/features';
import { computeFireStats, FireStats } from '../fire/stats';
import { computeFleetStats } from '../vehicles/stats';
import type { FollowerEntry } from '../vehicles/followerOrders';
import { FireGrid } from '../fire/grid';

// Simple icon system using Unicode/emoji and basic shapes
const ICONS = {
  fire: '🔥',
  water: '💧', 
  retardant: '🧪',
  road: '🛣️',
  firetruck: '🚒',
  bulldozer: '🚜',
  vehicle: '🚐',
  hydrant: '🚰',
  terrain: '🏔️',
  stats: '📊',
  settings: '⚙️',
  eye: '👁️',
  eyeOff: '👁️‍🗨️',
  play: '▶️',
  pause: '⏸️',
  clear: '🗑️',
  dropdown: '▼',
} as const;

// Vehicle types available for spawning
type VehicleType = 'firetruck' | 'bulldozer' | 'generic';

const VEHICLE_TYPES = {
  firetruck: { name: 'Fire Truck', icon: ICONS.firetruck, description: 'Fast response vehicle for water delivery' },
  bulldozer: { name: 'Bulldozer', icon: ICONS.bulldozer, description: 'Heavy vehicle for creating firebreaks' },
  generic: { name: 'Generic Vehicle', icon: ICONS.vehicle, description: 'Standard utility vehicle' },
} as const;

export type ToolMode =
  | 'ignite' 
  | 'water' 
  | 'retardant' 
  | 'roads' 
  | 'none';

type MenubarHandle = {
  setVisible: (visible: boolean) => void;
  isVisible: () => boolean;
  getCurrentTool: () => ToolMode;
  setActions: (actions: MenubarActions) => void;
  update: (dt: number, renderer: import('three').WebGLRenderer, opts?: {
    chunkGroup?: import('three').Group;
    forest?: { leaves: import('three').InstancedMesh; trunks: import('three').InstancedMesh; broadLeaves?: import('three').InstancedMesh; broadTrunks?: import('three').InstancedMesh };
    shrubs?: { inst: import('three').InstancedMesh };
    rocks?: { inst: import('three').InstancedMesh };
    fireGrid?: any;
    followers?: ReadonlyArray<FollowerEntry>;
  }) => void;
  setRefs?: (opts: any) => void;
  getIgniteMode: () => boolean;
};

type MenubarActions = {
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
    spawn?: (type?: VehicleType) => void;
    moveModeToggle?: (on: boolean) => void;
    clear?: () => void;
    toggleYawDebug?: (on: boolean) => void;
    toggleYawSmoothing?: (on: boolean) => void;
    setSpacingMode?: (m: 'hybrid' | 'gap' | 'time') => void;
  };
  hydrants?: {
    toggle?: (on: boolean) => void;
    update?: () => void;
    clear?: () => void;
  };
  ribbon?: {
    setVisible?: (on: boolean) => void;
    setWidth?: (w: number) => void;
    setOpacity?: (o: number) => void;
    setSpeed?: (v: number) => void;
  };
  preset?: {
    set?: (variant: 'loop' | 'figure8') => void;
  };
  config?: {
    get?: () => any;
    set?: (partial: any) => void;
    regenerate?: () => void;
  };
};

export function createMenubar(container: HTMLElement): MenubarHandle {
  let visible = config.debug.overlay_visible_on_start;
  let currentTool: ToolMode = 'none';
  let actions: MenubarActions = {};
  let igniteMode = false;
  let opts: any = {};
  let selectedVehicleType: VehicleType = 'generic';

  // Performance tracking
  let acc = 0;
  let frames = 0;
  let fps = 0;
  let lastMemoryUpdate = 0;
  let memoryInfo = { used: 0, total: 0, limit: 0 };

  // Create unified toolbar container
  const toolbar = document.createElement('div');
  toolbar.style.cssText = `
    position: absolute;
    top: 10px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(8, 12, 18, 0.76);
    backdrop-filter: blur(10px);
    border: 1px solid rgba(71, 85, 105, 0.42);
    border-radius: 10px;
    box-shadow: 0 16px 30px rgba(2, 6, 23, 0.28);
    padding: 6px 10px;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    justify-content: center;
    font-family: system-ui, sans-serif;
    font-size: 13px;
    color: #e5e7eb;
    pointer-events: auto;
    z-index: 1000;
    max-width: min(94vw, 1080px);
    gap: 6px;
  `;
  toolbar.dataset.testid = 'toolbar';

  container.appendChild(toolbar);

  // Main tools section
  const toolsSection = document.createElement('div');
  toolsSection.style.cssText = 'display: flex; gap: 4px; align-items: center;';
  toolbar.appendChild(toolsSection);

  // Stats display section
  const statsSection = document.createElement('div');
  statsSection.style.cssText = `
    margin-left: 8px;
    padding-left: 8px;
    border-left: 1px solid rgba(75, 85, 99, 0.6);
    font-size: 10.5px;
    color: #94a3b8;
    line-height: 1.3;
    min-width: 160px;
  `;
  toolbar.appendChild(statsSection);

  // Expandable controls section
  const controlsToggle = document.createElement('button');
  controlsToggle.style.cssText = `
    background: rgba(55, 65, 81, 0.8);
    border: 1px solid rgba(75, 85, 99, 0.8);
    border-radius: 6px;
    padding: 5px 7px;
    color: #e5e7eb;
    cursor: pointer;
    font-size: 11px;
    margin-left: 6px;
  `;
  controlsToggle.innerHTML = `<span style="font-size: 14px;">${ICONS.settings}</span>`;
  controlsToggle.title = 'Toggle detailed controls';
  controlsToggle.dataset.testid = 'toolbar-settings';
  toolbar.appendChild(controlsToggle);

  // Expandable controls panel
  const controlsPanel = document.createElement('div');
  controlsPanel.style.cssText = `
    position: absolute;
    top: 100%;
    right: 0;
    margin-top: 8px;
    background: rgba(0, 0, 0, 0.9);
    backdrop-filter: blur(4px);
    border-radius: 8px;
    padding: 12px;
    display: none;
    flex-direction: column;
    gap: 12px;
    min-width: 600px;
    max-height: 85vh;
    overflow-y: auto;
    z-index: 1001;
  `;
  toolbar.appendChild(controlsPanel);

  let controlsExpanded = false;
  controlsToggle.addEventListener('click', () => {
    controlsExpanded = !controlsExpanded;
    controlsPanel.style.display = controlsExpanded ? 'flex' : 'none';
    controlsToggle.style.background = controlsExpanded ? 'rgba(59, 130, 246, 0.3)' : 'rgba(55, 65, 81, 0.8)';
  });

  const slugify = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const setTestId = (el: HTMLElement, value: string) => {
    el.dataset.testid = value;
  };

  // Helper to create tool buttons
  const createToolButton = (icon: string, label: string, tool: ToolMode) => {
    const btn = document.createElement('button');
    btn.style.cssText = `
      background: rgba(55, 65, 81, 0.8);
      border: 1px solid rgba(75, 85, 99, 0.8);
      border-radius: 6px;
      padding: 5px 8px;
      color: #e5e7eb;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 11px;
      transition: all 0.2s ease;
    `;
    
    btn.innerHTML = `<span style="font-size: 14px;">${icon}</span><span>${label}</span>`;
    btn.title = label;
    setTestId(btn, `tool-${tool}`);
    
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
      if (tool === 'ignite') {
        igniteMode = !igniteMode;
        btn.innerHTML = `<span style="font-size: 14px;">${icon}</span><span>${igniteMode ? 'Stop' : label}</span>`;
        btn.style.background = igniteMode ? 'rgba(59, 130, 246, 0.3)' : 'rgba(55, 65, 81, 0.8)';
        btn.style.borderColor = igniteMode ? 'rgba(59, 130, 246, 0.6)' : 'rgba(75, 85, 99, 0.8)';
      } else {
        // Toggle tool or activate
        if (currentTool === tool) {
          setCurrentTool('none');
        } else {
          setCurrentTool(tool);
        }
      }
    });

    return btn;
  };

  // Helper to create action buttons
  const createActionButton = (icon: string, label: string, action: () => void, testId?: string) => {
    const btn = document.createElement('button');
    btn.style.cssText = `
      background: rgba(55, 65, 81, 0.8);
      border: 1px solid rgba(75, 85, 99, 0.8);
      border-radius: 6px;
      padding: 5px 8px;
      color: #e5e7eb;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 11px;
      transition: all 0.2s ease;
    `;
    
    btn.innerHTML = `<span style="font-size: 14px;">${icon}</span><span>${label}</span>`;
    btn.title = label;
    setTestId(btn, testId ?? `action-${slugify(label)}`);
    
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

  // Helper to create dropdown button with vehicle types
  const createVehicleDropdown = () => {
    const container = document.createElement('div');
    container.style.cssText = 'position: relative; display: inline-block;';
    setTestId(container, 'vehicle-controls');
    
    const mainBtn = document.createElement('button');
    mainBtn.style.cssText = `
      background: rgba(55, 65, 81, 0.8);
      border: 1px solid rgba(75, 85, 99, 0.8);
      border-radius: 6px 0 0 6px;
      padding: 5px 8px;
      color: #e5e7eb;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 11px;
      transition: all 0.2s ease;
    `;
    setTestId(mainBtn, 'vehicle-spawn-main');
    
    const updateMainButton = () => {
      const vehicleData = VEHICLE_TYPES[selectedVehicleType];
      mainBtn.innerHTML = `<span>${vehicleData.icon}</span><span>${vehicleData.name}</span>`;
      mainBtn.title = vehicleData.description;
    };
    
    updateMainButton();
    
    const dropdownBtn = document.createElement('button');
    dropdownBtn.style.cssText = `
      background: rgba(55, 65, 81, 0.8);
      border: 1px solid rgba(75, 85, 99, 0.8);
      border-left: none;
      border-radius: 0 6px 6px 0;
      padding: 5px 4px;
      color: #e5e7eb;
      cursor: pointer;
      display: flex;
      align-items: center;
      font-size: 10px;
      transition: all 0.2s ease;
    `;
    dropdownBtn.innerHTML = ICONS.dropdown;
    dropdownBtn.title = 'Select vehicle type';
    setTestId(dropdownBtn, 'vehicle-spawn-menu');
    
    const dropdown = document.createElement('div');
    dropdown.style.cssText = `
      position: absolute;
      top: 100%;
      left: 0;
      background: rgba(17, 24, 39, 0.95);
      border: 1px solid rgba(75, 85, 99, 0.8);
      border-radius: 6px;
      min-width: 180px;
      z-index: 1000;
      display: none;
      margin-top: 2px;
    `;
    
    // Create dropdown options
    Object.entries(VEHICLE_TYPES).forEach(([type, data]) => {
      const option = document.createElement('button');
      option.style.cssText = `
        width: 100%;
        padding: 8px 12px;
        background: none;
        border: none;
        color: #e5e7eb;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 12px;
        text-align: left;
        transition: background 0.2s ease;
      `;
      option.innerHTML = `<span>${data.icon}</span><span>${data.name}</span>`;
      option.title = data.description;
      setTestId(option, `vehicle-option-${type}`);
      
      option.addEventListener('mouseenter', () => {
        option.style.background = 'rgba(59, 130, 246, 0.2)';
      });
      option.addEventListener('mouseleave', () => {
        option.style.background = 'none';
      });
      
      option.addEventListener('click', () => {
        selectedVehicleType = type as VehicleType;
        updateMainButton();
        dropdown.style.display = 'none';
        // Update the selected state visually
        dropdown.querySelectorAll('button').forEach(btn => btn.style.fontWeight = 'normal');
        option.style.fontWeight = 'bold';
      });
      
      if (type === selectedVehicleType) {
        option.style.fontWeight = 'bold';
      }
      
      dropdown.appendChild(option);
    });
    
    // Main button click - spawn vehicle
    mainBtn.addEventListener('click', () => {
      actions.vehicles?.spawn?.(selectedVehicleType);
    });
    
    // Dropdown button click - toggle dropdown
    dropdownBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
    });
    
    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (!container.contains(e.target as Node)) {
        dropdown.style.display = 'none';
      }
    });
    
    // Hover effects
    [mainBtn, dropdownBtn].forEach(btn => {
      btn.addEventListener('mouseenter', () => {
        btn.style.background = 'rgba(75, 85, 99, 0.9)';
      });
      btn.addEventListener('mouseleave', () => {
        btn.style.background = 'rgba(55, 65, 81, 0.8)';
      });
    });
    
    container.appendChild(mainBtn);
    container.appendChild(dropdownBtn);
    container.appendChild(dropdown);
    
    return container;
  };

  // Create tool buttons
  const igniteBtn = createToolButton(ICONS.fire, 'Ignite', 'ignite');
  const waterBtn = createToolButton(ICONS.water, 'Water', 'water');
  const retardantBtn = createToolButton(ICONS.retardant, 'Retardant', 'retardant');
  const roadsBtn = createToolButton(ICONS.road, 'Roads', 'roads');

  // Create action buttons
  const igniteCenterBtn = createActionButton(ICONS.fire, 'Center', () => actions.fire?.igniteCenter?.(), 'action-ignite-center');
  const clearRoadsBtn = createActionButton(ICONS.clear, 'Clear', () => actions.roads?.clear?.(), 'action-clear-roads');
  const spawnVehicleDropdown = createVehicleDropdown();
  const clearVehiclesBtn = createActionButton(ICONS.clear, 'Clear', () => actions.vehicles?.clear?.(), 'action-clear-vehicles');

  // Build main toolbar layout
  toolsSection.appendChild(igniteBtn);
  toolsSection.appendChild(igniteCenterBtn);
  toolsSection.appendChild(createSeparator());
  toolsSection.appendChild(waterBtn);
  toolsSection.appendChild(retardantBtn);
  toolsSection.appendChild(createSeparator());
  toolsSection.appendChild(roadsBtn);
  toolsSection.appendChild(clearRoadsBtn);
  toolsSection.appendChild(createSeparator());
  toolsSection.appendChild(spawnVehicleDropdown);
  toolsSection.appendChild(clearVehiclesBtn);

  // Current tool indicator in toolbar
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
  toolsSection.appendChild(toolIndicator);

  // Build detailed controls panel content
  const buildControlsPanel = () => {
    controlsPanel.innerHTML = '';

    // Helper to create control sections
    const createSection = (title: string, content: HTMLElement) => {
      const section = document.createElement('div');
      section.style.cssText = 'border: 1px solid rgba(75, 85, 99, 0.4); border-radius: 6px; padding: 8px; background: rgba(17, 24, 39, 0.3);';
      
      const header = document.createElement('div');
      header.style.cssText = 'font-weight: 600; color: #93c5fd; margin-bottom: 8px; font-size: 12px;';
      header.textContent = title;
      
      section.appendChild(header);
      section.appendChild(content);
      return section;
    };

    // Fire Controls Section
    const fireControls = document.createElement('div');
    fireControls.style.cssText = 'display: flex; flex-direction: column; gap: 6px;';
    
    // Fire viz mode selector
    const vizRow = document.createElement('div');
    vizRow.style.cssText = 'display: flex; align-items: center; gap: 8px;';
    const vizLabel = document.createElement('span');
    vizLabel.textContent = 'Fire Viz:';
    vizLabel.style.cssText = 'color: #cbd5e1; font-size: 12px;';
    const vizSelect = document.createElement('select');
    vizSelect.style.cssText = 'background: #111827; color: #e5e7eb; border: 1px solid #374151; border-radius: 4px; padding: 2px 4px; font-size: 11px;';
    ['overlay', 'raised', 'vertex'].forEach(opt => {
      const option = document.createElement('option');
      option.value = opt;
      option.text = opt;
      vizSelect.appendChild(option);
    });
    vizSelect.value = 'vertex';
    vizSelect.addEventListener('change', () => actions.fire?.setVizMode?.(vizSelect.value as any));
    vizRow.appendChild(vizLabel);
    vizRow.appendChild(vizSelect);
    fireControls.appendChild(vizRow);

    // Ribbon controls
    const ribbonRow = document.createElement('div');
    ribbonRow.style.cssText = 'display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 4px;';
    
    const ribbonToggle = document.createElement('button');
    ribbonToggle.style.cssText = 'background: #111827; color: #e5e7eb; border: 1px solid #374151; border-radius: 4px; padding: 2px 6px; font-size: 11px; cursor: pointer;';
    let ribbonOn = true;
    ribbonToggle.textContent = 'Ribbon: On';
    ribbonToggle.addEventListener('click', () => {
      ribbonOn = !ribbonOn;
      ribbonToggle.textContent = `Ribbon: ${ribbonOn ? 'On' : 'Off'}`;
      actions.ribbon?.setVisible?.(ribbonOn);
    });
    
    const ribbonControls = ['Width', 'Opacity', 'Speed'].map((label, idx) => {
      const values = [0.9, 0.85, 0.35];
      const ranges = [[0.2, 1.5, 0.05], [0.1, 1.0, 0.05], [0.05, 1.0, 0.05]];
      const callbacks = [actions.ribbon?.setWidth, actions.ribbon?.setOpacity, actions.ribbon?.setSpeed];
      
      const wrapper = document.createElement('span');
      wrapper.style.cssText = 'display: flex; align-items: center; gap: 4px;';
      const labelSpan = document.createElement('span');
      labelSpan.textContent = label;
      labelSpan.style.cssText = 'color: #cbd5e1; font-size: 11px; min-width: 45px;';
      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = ranges[idx][0].toString();
      slider.max = ranges[idx][1].toString();
      slider.step = ranges[idx][2].toString();
      slider.value = values[idx].toString();
      slider.style.cssText = 'width: 80px;';
      slider.addEventListener('input', () => callbacks[idx]?.(Number(slider.value)));
      wrapper.appendChild(labelSpan);
      wrapper.appendChild(slider);
      return wrapper;
    });
    
    ribbonRow.appendChild(ribbonToggle);
    ribbonControls.forEach(control => ribbonRow.appendChild(control));
    fireControls.appendChild(ribbonRow);

    // Fire statistics display
    const fireStats = document.createElement('div');
    fireStats.style.cssText =
      'margin-top: 6px; font-size: 11px; color: #94a3b8; line-height: 1.3; font-family: ui-monospace, monospace; white-space: pre;';
    fireStats.className = 'fire-stats';
    fireStats.textContent = 'No fire activity';
    fireControls.appendChild(fireStats);

    // Fleet statistics display (populated from opts.followers in update())
    const fleetStats = document.createElement('div');
    fleetStats.style.cssText =
      'margin-top: 6px; font-size: 11px; color: #94a3b8; line-height: 1.3; font-family: ui-monospace, monospace; white-space: pre;';
    fleetStats.className = 'fleet-stats';
    fleetStats.textContent = 'No vehicles';
    fireControls.appendChild(fleetStats);

    controlsPanel.appendChild(createSection('🔥 Fire System', fireControls));

    // Vehicle Controls Section
    const vehicleControls = document.createElement('div');
    vehicleControls.style.cssText = 'display: flex; flex-wrap: wrap; align-items: center; gap: 8px;';
    
    // Vehicle mode controls
    const vehModeBtn = document.createElement('button');
    vehModeBtn.style.cssText = 'background: #111827; color: #e5e7eb; border: 1px solid #374151; border-radius: 4px; padding: 2px 6px; font-size: 11px; cursor: pointer;';
    let vehMoveOn = false;
    vehModeBtn.textContent = 'Move: Off';
    vehModeBtn.addEventListener('click', () => {
      vehMoveOn = !vehMoveOn;
      vehModeBtn.textContent = `Move: ${vehMoveOn ? 'On' : 'Off'}`;
      actions.vehicles?.moveModeToggle?.(vehMoveOn);
    });

    const yawBtn = document.createElement('button');
    yawBtn.style.cssText = 'background: #111827; color: #e5e7eb; border: 1px solid #374151; border-radius: 4px; padding: 2px 6px; font-size: 11px; cursor: pointer;';
    let yawDebugOn = false;
    yawBtn.textContent = 'Yaw Debug: Off';
    yawBtn.addEventListener('click', () => {
      yawDebugOn = !yawDebugOn;
      yawBtn.textContent = `Yaw Debug: ${yawDebugOn ? 'On' : 'Off'}`;
      actions.vehicles?.toggleYawDebug?.(yawDebugOn);
    });

    const smoothBtn = document.createElement('button');
    smoothBtn.style.cssText = 'background: #111827; color: #e5e7eb; border: 1px solid #374151; border-radius: 4px; padding: 2px 6px; font-size: 11px; cursor: pointer;';
    let smoothOn = true;
    smoothBtn.textContent = 'Yaw Smooth: On';
    smoothBtn.addEventListener('click', () => {
      smoothOn = !smoothOn;
      smoothBtn.textContent = `Yaw Smooth: ${smoothOn ? 'On' : 'Off'}`;
      actions.vehicles?.toggleYawSmoothing?.(smoothOn);
    });

    // Spacing mode selector
    const spacingWrapper = document.createElement('span');
    spacingWrapper.style.cssText = 'display: flex; align-items: center; gap: 4px;';
    const spacingLabel = document.createElement('span');
    spacingLabel.textContent = 'Spacing:';
    spacingLabel.style.cssText = 'color: #cbd5e1; font-size: 11px;';
    const spacingSelect = document.createElement('select');
    spacingSelect.style.cssText = 'background: #111827; color: #e5e7eb; border: 1px solid #374151; border-radius: 4px; padding: 1px 4px; font-size: 11px;';
    ['hybrid', 'gap', 'time'].forEach(mode => {
      const opt = document.createElement('option');
      opt.value = mode; opt.text = mode;
      spacingSelect.appendChild(opt);
    });
    spacingSelect.value = 'hybrid';
    spacingSelect.addEventListener('change', () => actions.vehicles?.setSpacingMode?.(spacingSelect.value as any));
    spacingWrapper.appendChild(spacingLabel);
    spacingWrapper.appendChild(spacingSelect);

    vehicleControls.appendChild(vehModeBtn);
    vehicleControls.appendChild(yawBtn);
    vehicleControls.appendChild(smoothBtn);
    vehicleControls.appendChild(spacingWrapper);

    controlsPanel.appendChild(createSection('🚗 Vehicles', vehicleControls));

    // Fire Hydrants Section
    const hydrantControls = document.createElement('div');
    hydrantControls.style.cssText = 'display: flex; flex-direction: column; gap: 6px;';

    const hydrantVisBtn = document.createElement('button');
    hydrantVisBtn.style.cssText = 'background: #111827; color: #e5e7eb; border: 1px solid #374151; border-radius: 4px; padding: 2px 6px; font-size: 11px; cursor: pointer;';
    let hydrantsVisible = true;
    hydrantVisBtn.textContent = 'Visible: On';
    hydrantVisBtn.addEventListener('click', () => {
      hydrantsVisible = !hydrantsVisible;
      hydrantVisBtn.textContent = `Visible: ${hydrantsVisible ? 'On' : 'Off'}`;
      actions.hydrants?.toggle?.(hydrantsVisible);
    });

    const hydrantUpdateBtn = document.createElement('button');
    hydrantUpdateBtn.style.cssText = 'background: #111827; color: #e5e7eb; border: 1px solid #374151; border-radius: 4px; padding: 2px 6px; font-size: 11px; cursor: pointer;';
    hydrantUpdateBtn.textContent = 'Update Placement';
    hydrantUpdateBtn.addEventListener('click', () => actions.hydrants?.update?.());

    const hydrantClearBtn = document.createElement('button');
    hydrantClearBtn.style.cssText = 'background: #dc2626; color: #ffffff; border: 1px solid #dc2626; border-radius: 4px; padding: 2px 6px; font-size: 11px; cursor: pointer;';
    hydrantClearBtn.textContent = 'Clear All';
    hydrantClearBtn.addEventListener('click', () => actions.hydrants?.clear?.());

    hydrantControls.appendChild(hydrantVisBtn);
    hydrantControls.appendChild(hydrantUpdateBtn);
    hydrantControls.appendChild(hydrantClearBtn);

    controlsPanel.appendChild(createSection('🚰 Hydrants', hydrantControls));

    // Terrain Configuration Section
    const terrainControls = document.createElement('div');
    terrainControls.style.cssText = 'display: flex; flex-direction: column; gap: 6px;';
    
    const cfg = () => actions.config?.get?.() ?? {};
    
    // Helper to create range inputs
    const createRange = (label: string, min: number, max: number, step: number, value: number, callback: (v: number) => void) => {
      const row = document.createElement('div');
      row.style.cssText = 'display: flex; align-items: center; gap: 8px; justify-content: space-between;';
      
      const labelSpan = document.createElement('span');
      labelSpan.textContent = label;
      labelSpan.style.cssText = 'color: #cbd5e1; font-size: 11px; min-width: 80px;';
      
      const input = document.createElement('input');
      input.type = 'range';
      input.min = min.toString();
      input.max = max.toString();
      input.step = step.toString();
      input.value = value.toString();
      input.style.cssText = 'flex: 1; max-width: 120px;';
      
      const valueSpan = document.createElement('span');
      valueSpan.textContent = value.toString();
      valueSpan.style.cssText = 'color: #94a3b8; font-size: 10px; min-width: 30px; text-align: right;';
      
      input.addEventListener('input', () => {
        const val = Number(input.value);
        valueSpan.textContent = val.toString();
        callback(val);
      });
      
      row.appendChild(labelSpan);
      row.appendChild(input);
      row.appendChild(valueSpan);
      return row;
    };

    // Add terrain controls with current config values and proper callbacks
    const currentCfg = cfg();
    terrainControls.appendChild(createRange('Size', 64, 512, 32, currentCfg.width ?? 128, (v) => {
      const newCfg = { ...currentCfg, width: v, height: v };
      actions.config?.set?.(newCfg);
    }));
    terrainControls.appendChild(createRange('Noise Freq', 0.2, 6.0, 0.1, currentCfg.noise?.frequency ?? 2.0, (v) => {
      const newCfg = { ...currentCfg, noise: { ...currentCfg.noise, frequency: v } };
      actions.config?.set?.(newCfg);
    }));
    terrainControls.appendChild(createRange('Noise Amp', 1, 20, 1, currentCfg.noise?.amplitude ?? 8, (v) => {
      const newCfg = { ...currentCfg, noise: { ...currentCfg.noise, amplitude: v } };
      actions.config?.set?.(newCfg);
    }));
    terrainControls.appendChild(createRange('Forest Min', 0.0, 1.0, 0.01, currentCfg.biomes?.forestMoistureMin ?? 0.55, (v) => {
      const newCfg = { ...currentCfg, biomes: { ...currentCfg.biomes, forestMoistureMin: v } };
      actions.config?.set?.(newCfg);
    }));
    terrainControls.appendChild(createRange('Trees', 0.0, 0.6, 0.01, currentCfg.densities?.tree ?? 0.30, (v) => {
      const newCfg = { ...currentCfg, densities: { ...currentCfg.densities, tree: v } };
      actions.config?.set?.(newCfg);
    }));
    terrainControls.appendChild(createRange('Shrubs', 0.0, 0.4, 0.01, currentCfg.densities?.shrub ?? 0.15, (v) => {
      const newCfg = { ...currentCfg, densities: { ...currentCfg.densities, shrub: v } };
      actions.config?.set?.(newCfg);
    }));
    terrainControls.appendChild(createRange('Rocks', 0.0, 0.2, 0.01, currentCfg.densities?.rock ?? 0.08, (v) => {
      const newCfg = { ...currentCfg, densities: { ...currentCfg.densities, rock: v } };
      actions.config?.set?.(newCfg);
    }));

    // Regenerate button
    const regenBtn = document.createElement('button');
    regenBtn.textContent = 'Regenerate Terrain';
    regenBtn.style.cssText = 'background: #111827; color: #e5e7eb; border: 1px solid #374151; border-radius: 4px; padding: 4px 8px; font-size: 11px; cursor: pointer; margin-top: 4px;';
    regenBtn.addEventListener('click', () => actions.config?.regenerate?.());
    terrainControls.appendChild(regenBtn);

    controlsPanel.appendChild(createSection('🏔️ Terrain', terrainControls));
  };

  // Initialize controls panel
  buildControlsPanel();

  // Function to update current tool
  const setCurrentTool = (tool: ToolMode) => {
    currentTool = tool;
    
    // Update button styles
    [waterBtn, retardantBtn, roadsBtn].forEach(btn => {
      btn.style.background = 'rgba(55, 65, 81, 0.8)';
      btn.style.borderColor = 'rgba(75, 85, 99, 0.8)';
    });

    // Highlight active tool
    let activeBtn: HTMLButtonElement | null = null;
    switch (tool) {
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
  toolbar.style.display = visible ? 'flex' : 'none';

  // Toggle with F1
  window.addEventListener('keydown', (e) => {
    if ((e.key === 'F1' || e.key === 'f1') && config.features.debug_overlay) {
      visible = !visible;
      toolbar.style.display = visible ? 'flex' : 'none';
      e.preventDefault();
    }
  });

  return {
    setVisible(vis: boolean) {
      visible = vis;
      toolbar.style.display = visible ? 'flex' : 'none';
    },
    isVisible() {
      return visible;
    },
    getCurrentTool() {
      return currentTool;
    },
    setActions(newActions: MenubarActions) {
      actions = newActions;
      buildControlsPanel(); // Rebuild panel when actions change
    },
    update(dt: number, renderer: import('three').WebGLRenderer, updateOpts: any = {}) {
      opts = { ...opts, ...updateOpts };
      
      // Update FPS
      acc += dt; 
      frames++;
      if (acc >= 0.5) { 
        fps = Math.round(frames / acc); 
        acc = 0; 
        frames = 0; 
      }
      
      // Update memory info every second
      const now = performance.now();
      if (config.debug.memory_metrics_enabled && visible && now - lastMemoryUpdate > 1000) {
        lastMemoryUpdate = now;
        if ('memory' in performance) {
          const mem = (performance as any).memory;
          memoryInfo = {
            used: Math.round(mem.usedJSHeapSize / 1048576), // MB
            total: Math.round(mem.totalJSHeapSize / 1048576), // MB
            limit: Math.round(mem.jsHeapSizeLimit / 1048576), // MB
          };
        }
      }
      
      const info = renderer.info;

      // Compute stats
      let chunks = 0, chunksVis = 0, lodHi = 0, lodLo = 0;
      if (opts.chunkGroup) {
        const children = opts.chunkGroup.children as any[];
        chunks = children.length;
        for (const m of children) {
          if (m.visible) {
            chunksVis++;
            if (m.geometry === m.userData?.geoHi) lodHi++; else lodLo++;
          }
        }
      }

      const treeConifer = opts.forest ? ((opts.forest.leaves as any).count ?? (opts.forest.leaves as any).instanceCount ?? 0) : 0;
      const treeBroad = opts.forest?.broadLeaves ? (((opts.forest.broadLeaves as any).count ?? (opts.forest.broadLeaves as any).instanceCount) ?? 0) : 0;
      const treeCount = treeConifer + treeBroad;
      const shrubCount = opts.shrubs ? ((opts.shrubs.inst as any).count ?? (opts.shrubs.inst as any).instanceCount ?? 0) : 0;
      const rockCount = opts.rocks ? ((opts.rocks.inst as any).count ?? (opts.rocks.inst as any).instanceCount ?? 0) : 0;

      // Update stats display
      let statsText = `FPS ${fps} • Calls ${info.render.calls} • Tris ${info.render.triangles}`;
      
      if (config.debug.memory_metrics_enabled && memoryInfo.total > 0) {
        statsText += ` • Memory ${memoryInfo.used}/${memoryInfo.total} MB`;
      }
      
      if (opts.chunkGroup) {
        statsText += `\nChunks ${chunksVis}/${chunks} • LOD H:${lodHi} L:${lodLo}`;
      }
      
      if (opts.forest || opts.shrubs || opts.rocks) {
        statsText += `\nTrees ${treeCount}${treeBroad ? ` (broad ${treeBroad})` : ''} • Shrubs ${shrubCount} • Rocks ${rockCount}`;
      }

      statsSection.textContent = statsText;

      // Update fire statistics
      if (opts.fireGrid) {
        const fireStats = computeFireStats(opts.fireGrid);
        let fireStatsDiv = controlsPanel.querySelector('.fire-stats') as HTMLDivElement | null;
        // Lazily create stats container if absent (legacy overlays)
        if (!fireStatsDiv) {
          fireStatsDiv = document.createElement('div');
          fireStatsDiv.className = 'fire-stats';
          fireStatsDiv.style.cssText =
            'margin-top: 6px; font-size: 11px; color: #94a3b8; line-height: 1.3; font-family: ui-monospace, monospace; white-space: pre;';
          fireStatsDiv.textContent = 'No fire activity';
          controlsPanel.appendChild(fireStatsDiv);
        }
        if (fireStats.active === 0 && fireStats.burnedTiles === 0) {
          fireStatsDiv.textContent = 'No fire activity';
        } else {
          const burnedAreaHa = fireStats.burnedAreaWorld / 10000; // Convert m² to hectares
          const perimeterKm = fireStats.perimeterWorld / 1000; // Convert m to km
          fireStatsDiv.textContent = [
            `Burning: ${fireStats.burning} tiles`,
            `Burned area: ${burnedAreaHa.toFixed(1)} ha`,
            `Perimeter: ${perimeterKm.toFixed(2)} km`
          ].join('\n');
        }
      }

      // Update fleet statistics
      if (opts.followers) {
        const followers = opts.followers as ReadonlyArray<FollowerEntry>;
        const fleetStatsDiv = controlsPanel.querySelector('.fleet-stats') as HTMLDivElement | null;
        if (fleetStatsDiv) {
          if (followers.length === 0) {
            fleetStatsDiv.textContent = 'No vehicles';
          } else {
            const fs = computeFleetStats(followers);
            const typeBreakdown = Object.entries(fs.byType)
              .filter(([, n]) => n > 0)
              .map(([t, n]) => `${t}:${n}`)
              .join(' ');
            fleetStatsDiv.textContent = [
              `Fleet: ${fs.total} (${fs.moving} moving, ${fs.idle} idle)`,
              `Types: ${typeBreakdown}`,
              `Mean speed: ${fs.meanSpeed.toFixed(2)} m/s`,
              `Water capacity: ${fs.totalWaterCapacity} L`,
            ].join('\n');
          }
        }
      }

      // Reset auto counters each frame
      info.reset();
    },
    setRefs(newOpts: any) {
      opts = { ...opts, ...newOpts };
    },
    getIgniteMode() {
      return igniteMode;
    }
  };
}
