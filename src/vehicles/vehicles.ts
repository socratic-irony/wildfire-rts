import { ArrowHelper, Color, Group, IcosahedronGeometry, InstancedMesh, Matrix4, MeshBasicMaterial, MeshStandardMaterial, Object3D, Quaternion, Vector3, SphereGeometry, CylinderGeometry, ConeGeometry, BufferGeometry, BufferAttribute } from 'three';
import { BoxGeometry } from 'three';
import { InstancedParticleSystem } from '../particles/system';
import type { Heightmap } from '../terrain/heightmap';
import type { RoadMask } from '../roads/state';
import type { RoadsVisual } from '../roads/visual';
import type { TerrainCost } from '../roads/cost';
import type { FireGrid } from '../fire/grid';
import { applyWaterAoE } from '../fire/grid';
import { aStarPath } from '../roads/astar';
import { makeAngularPath } from '../roads/path';

type GridPoint = { x: number; z: number };

export enum VehicleType {
  CAR = 'car',
  FIRETRUCK = 'firetruck', 
  BULLDOZER = 'bulldozer',
  HELICOPTER = 'helicopter',
  AIRPLANE = 'airplane',
  FIREFIGHTER = 'firefighter'
}

type Agent = {
  vehicleType: VehicleType;
  pos: Vector3;
  prevPos?: Vector3;
  grid: GridPoint; // current nearest grid cell
  path: GridPoint[];
  pathIdx: number;
  speedTilesPerSec: number; // tiles/sec
  // Road-follow state
  autoFollowRoad: boolean;
  prev?: GridPoint; // previous grid cell when following road
  // Midline projection hint/state
  pin?: { pathIndex: number; segIndex?: number };
  lastProj?: { normal: Vector3; tangent: Vector3 };
  prevTan?: Vector3;
  waitingFor?: string; // intersection key queued at
  intersection?: string; // intersection key being crossed
  stopTimer?: number; // remaining stop time before entering intersection
  altitude?: number; // height offset for airborne vehicles
  debug?: {
    yawMode: string;
    usedProj: boolean;
    fwd: { x: number; y: number; z: number };
    up: { x: number; y: number; z: number };
    right: { x: number; y: number; z: number };
    pinPath?: number;
    pinSeg?: number;
    lastTan?: { x: number; y: number; z: number };
    terrN?: { x: number; y: number; z: number };
    pathIdx: number;
    grid: { x: number; z: number };
    pos: { x: number; y: number; z: number };
    note?: string;
  };
  prevQuat?: Quaternion;
  rotorAngle?: number;
  turnSignalLeft?: number;
  turnSignalRight?: number;
};

export type VehicleFxState = {
  id: number;
  pos: Vector3;
  forward: Vector3;
  up: Vector3;
  right: Vector3;
  speed: number;
  type: VehicleType;
  sprayingWater?: boolean;
  siren?: boolean;
};

export class VehiclesManager {
  public group = new Group();
  public particleGroup = new Group(); // Separate group for particles that should always be visible
  private hm: Heightmap;
  private roadMask: RoadMask;
  private terrain: TerrainCost;
  private maxAgents: number;
  private agents: Agent[] = [];
  private vehicleInstances = new Map<VehicleType, InstancedMesh>();
  private vehicleCounts = new Map<VehicleType, number>();
  private instVane: InstancedMesh;
  private tmpObj = new Object3D();
  private tmpObj2 = new Object3D();
  private tmpObj3 = new Object3D();
  private cellSize: number; // hm.scale
  private roadsVis?: RoadsVisual;
  private fireGrid?: FireGrid;
  private landingZones: GridPoint[] = [];
  private yawMode: 'grid' | 'midline' | 'velocity' | 'lookahead' = 'midline';
  private speedCurviness = 0.6; // weight for curvature speed reduction
  private speedMinFactor = 0.45;
  private spacingRadius = 0.7; // in world units (meters)
  private yawDebugOn = false;
  private yawDebugIndex = 0;
  private yawArrow?: ArrowHelper;
  private lastDt = 0;
  private smoothYaw = true;
  private intersectionQueues = new Map<string, number[]>();
  private intersectionOccupants = new Map<string, number>();
  private stopDuration = 0.5; // seconds to wait at four-way stops
  private instRotor: InstancedMesh;
  private instHeadlight: InstancedMesh;
  private instSignal: InstancedMesh;
  private instFlasher: InstancedMesh;
  private smokeParticles: InstancedParticleSystem;
  private dustParticles: InstancedParticleSystem;
  private waterParticles: InstancedParticleSystem;
  private headlightCount = 0;
  private signalCount = 0;
  private flasherCount = 0;
  private elapsed = 0;
  private externalEmitters = new Map<number, { dustAcc: number; waterAcc: number; active: boolean }>();
  private tmpVec = new Vector3();
  private tmpVec2 = new Vector3();
  private tmpVec3 = new Vector3();

  constructor(hm: Heightmap, terrain: TerrainCost, roadMask: RoadMask, maxAgents = 64, roadsVis?: RoadsVisual, fireGrid?: FireGrid) {
    this.hm = hm; this.terrain = terrain; this.roadMask = roadMask; this.maxAgents = maxAgents;
    this.cellSize = hm.scale;
    this.roadsVis = roadsVis;
    this.fireGrid = fireGrid;
    
    // Initialize vehicle counts
    for (const vehicleType of Object.values(VehicleType)) {
      this.vehicleCounts.set(vehicleType, 0);
    }
    
    // Create instanced meshes for each vehicle type
    this.createVehicleInstances(maxAgents);

    // Heading indicator (weathervane) above vehicle for debugging orientation
    const vaneGeo = new BoxGeometry(this.cellSize * 0.12, this.cellSize * 0.28, this.cellSize * 0.12);
    const vaneMat = new MeshStandardMaterial({ color: new Color(0xff4444), roughness: 0.8, metalness: 0.0, emissive: new Color(0x220000), emissiveIntensity: 0.3 });
    this.instVane = new InstancedMesh(vaneGeo, vaneMat, maxAgents);
    this.instVane.instanceMatrix.setUsage(35048);
    this.instVane.frustumCulled = false;
    this.instVane.castShadow = false;
    this.instVane.receiveShadow = false;
    this.group.add(this.instVane);

    // Rotor for helicopters
    const rotorGeo = new CylinderGeometry(this.cellSize * 0.6, this.cellSize * 0.6, this.cellSize * 0.04, 6);
    const rotorMat = new MeshStandardMaterial({ color: new Color(0x222222), roughness: 0.8, metalness: 0.2, emissive: new Color(0x111111), emissiveIntensity: 0.2 });
    this.instRotor = new InstancedMesh(rotorGeo, rotorMat, maxAgents);
    this.instRotor.instanceMatrix.setUsage(35048);
    this.instRotor.frustumCulled = false;
    this.instRotor.castShadow = false;
    this.instRotor.receiveShadow = false;
    this.group.add(this.instRotor);

    // Lights
    const lightGeo = new SphereGeometry(this.cellSize * 0.08, 8, 8);
    const headMat = new MeshStandardMaterial({ color: new Color(0xffffff), emissive: new Color(0xffffff), emissiveIntensity: 1.5, roughness: 0.2, metalness: 0.0 });
    this.instHeadlight = new InstancedMesh(lightGeo, headMat, maxAgents * 2);
    this.instHeadlight.instanceMatrix.setUsage(35048);
    this.instHeadlight.frustumCulled = false;
    this.instHeadlight.castShadow = false;
    this.instHeadlight.receiveShadow = false;
    this.group.add(this.instHeadlight);

    const signalMat = new MeshStandardMaterial({ color: new Color(0xffa500), emissive: new Color(0xffa500), emissiveIntensity: 1.5, roughness: 0.3, metalness: 0.0 });
    this.instSignal = new InstancedMesh(lightGeo, signalMat, maxAgents * 2);
    this.instSignal.instanceMatrix.setUsage(35048);
    this.instSignal.frustumCulled = false;
    this.instSignal.castShadow = false;
    this.instSignal.receiveShadow = false;
    this.group.add(this.instSignal);

    const flasherMat = new MeshStandardMaterial({ color: new Color(0xff0000), emissive: new Color(0xff0000), emissiveIntensity: 1.5, roughness: 0.3, metalness: 0.0 });
    this.instFlasher = new InstancedMesh(lightGeo, flasherMat, maxAgents);
    this.instFlasher.instanceMatrix.setUsage(35048);
    this.instFlasher.frustumCulled = false;
    this.instFlasher.castShadow = false;
    this.instFlasher.receiveShadow = false;
    this.group.add(this.instFlasher);

    // Particle systems for smoke trails, dust, and water spray
    const ico = new IcosahedronGeometry(this.cellSize * 0.1, 0);
    const smokeMat = new MeshBasicMaterial({ color: 0xffffff });
    const dustMat = new MeshBasicMaterial({ color: 0xc6ad8d });
    const waterMat = new MeshBasicMaterial({ color: 0x9ec9ff });
    this.smokeParticles = new InstancedParticleSystem('smoke', ico, smokeMat, maxAgents * 40);
    this.dustParticles = new InstancedParticleSystem('smoke', ico, dustMat, maxAgents * 40, {
      horizontalWind: 0.25,
      upwardAccel: 0.08,
      slopeResponse: 0.15,
    });
    this.waterParticles = new InstancedParticleSystem('smoke', ico, waterMat, maxAgents * 30, {
      horizontalWind: 0.12,
      upwardAccel: -1.4,
      slopeResponse: 0.0,
    });
    this.particleGroup.add(this.smokeParticles.mesh, this.dustParticles.mesh, this.waterParticles.mesh);
  }

  private createFirefighterGeometry(): BufferGeometry {
    // Create three cylinders positioned next to each other to represent a group of firefighters
    // Apply height scaling for better visibility
    const HEIGHT_SCALE = 1.8;
    const cylinderGeo = new CylinderGeometry(
      this.cellSize * 0.08, 
      this.cellSize * 0.08, 
      this.cellSize * 0.5 * HEIGHT_SCALE
    );
    
    // Create three copies and position them side by side
    const geo1 = cylinderGeo.clone();
    const geo2 = cylinderGeo.clone();
    const geo3 = cylinderGeo.clone();
    
    // Position the cylinders: one in center, one left, one right
    geo1.translate(-this.cellSize * 0.15, 0, 0); // Left
    geo2.translate(0, 0, 0); // Center
    geo3.translate(this.cellSize * 0.15, 0, 0); // Right
    
    // Merge the geometries manually
    const mergedGeo = new BufferGeometry();
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    
    let indexOffset = 0;
    
    // Add each geometry to the arrays
    [geo1, geo2, geo3].forEach(geo => {
      const posAttr = geo.getAttribute('position');
      const normAttr = geo.getAttribute('normal');
      const uvAttr = geo.getAttribute('uv');
      const indexAttr = geo.getIndex();
      
      if (posAttr && normAttr && uvAttr && indexAttr) {
        // Add positions
        for (let i = 0; i < posAttr.count; i++) {
          positions.push(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
        }
        
        // Add normals
        for (let i = 0; i < normAttr.count; i++) {
          normals.push(normAttr.getX(i), normAttr.getY(i), normAttr.getZ(i));
        }
        
        // Add UVs
        for (let i = 0; i < uvAttr.count; i++) {
          uvs.push(uvAttr.getX(i), uvAttr.getY(i));
        }
        
        // Add indices with offset
        for (let i = 0; i < indexAttr.count; i++) {
          indices.push(indexAttr.getX(i) + indexOffset);
        }
        
        indexOffset += posAttr.count;
      }
    });
    
    // Set the merged attributes
    mergedGeo.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    mergedGeo.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
    mergedGeo.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
    mergedGeo.setIndex(indices);
    
    return mergedGeo;
  }

  private createVehicleInstances(maxAgents: number) {
    // Global height scaling for better vertical readability
    const HEIGHT_SCALE = 1.8;
    
    // CAR (elongated box - more car-like proportions)
    const carGeo = new BoxGeometry(
      this.cellSize * 0.5, 
      this.cellSize * 0.25 * HEIGHT_SCALE, 
      this.cellSize * 1.0
    );
    const carMat = new MeshStandardMaterial({ 
      color: new Color(0x1e90ff), 
      roughness: 0.7, 
      metalness: 0.1, 
      emissive: new Color(0x0a1a2a), 
      emissiveIntensity: 0.2 
    });
    this.createVehicleInstance(VehicleType.CAR, carGeo, carMat, maxAgents);

    // FIRETRUCK (wide and tall box - more truck-like)
    const firetruckGeo = new BoxGeometry(
      this.cellSize * 0.9, 
      this.cellSize * 0.6 * HEIGHT_SCALE, 
      this.cellSize * 1.6
    );
    const firetruckMat = new MeshStandardMaterial({ 
      color: new Color(0xcc0000), 
      roughness: 0.6, 
      metalness: 0.2, 
      emissive: new Color(0x220000), 
      emissiveIntensity: 0.3 
    });
    this.createVehicleInstance(VehicleType.FIRETRUCK, firetruckGeo, firetruckMat, maxAgents);

    // BULLDOZER (squat yellow cube - construction vehicle proportions)
    const bulldozerGeo = new BoxGeometry(
      this.cellSize * 0.7, 
      this.cellSize * 0.35 * HEIGHT_SCALE, 
      this.cellSize * 0.8
    );
    const bulldozerMat = new MeshStandardMaterial({ 
      color: new Color(0xffdd00), 
      roughness: 0.8, 
      metalness: 0.3, 
      emissive: new Color(0x332200), 
      emissiveIntensity: 0.2 
    });
    this.createVehicleInstance(VehicleType.BULLDOZER, bulldozerGeo, bulldozerMat, maxAgents);

    // HELICOPTER (sphere body - aircraft proportions)
    const helicopterGeo = new SphereGeometry(this.cellSize * 0.35, 8, 6);
    const helicopterMat = new MeshStandardMaterial({ 
      color: new Color(0x444444), 
      roughness: 0.5, 
      metalness: 0.4, 
      emissive: new Color(0x111111), 
      emissiveIntensity: 0.2 
    });
    this.createVehicleInstance(VehicleType.HELICOPTER, helicopterGeo, helicopterMat, maxAgents);

    // AIRPLANE (cone for pointed nose/fuselage - aircraft proportions)
    const airplaneGeo = new ConeGeometry(this.cellSize * 0.25, this.cellSize * 1.4, 6);
    const airplaneMat = new MeshStandardMaterial({ 
      color: new Color(0x666666), 
      roughness: 0.4, 
      metalness: 0.6, 
      emissive: new Color(0x111111), 
      emissiveIntensity: 0.1 
    });
    this.createVehicleInstance(VehicleType.AIRPLANE, airplaneGeo, airplaneMat, maxAgents);

    // FIREFIGHTER (group of three orange/red cylinders standing up)
    const firefighterGeo = this.createFirefighterGeometry();
    const firefighterMat = new MeshStandardMaterial({ 
      color: new Color(0xff6600), 
      roughness: 0.9, 
      metalness: 0.0, 
      emissive: new Color(0x330000), 
      emissiveIntensity: 0.4 
    });
    this.createVehicleInstance(VehicleType.FIREFIGHTER, firefighterGeo, firefighterMat, maxAgents);
  }

  private createVehicleInstance(vehicleType: VehicleType, geometry: any, material: MeshStandardMaterial, maxAgents: number) {
    const inst = new InstancedMesh(geometry, material, maxAgents);
    inst.instanceMatrix.setUsage(35048); // DynamicDrawUsage
    inst.frustumCulled = false;
    inst.castShadow = true;
    inst.receiveShadow = false;
    this.vehicleInstances.set(vehicleType, inst);
    this.group.add(inst);
  }

  get count() { return this.agents.length; }

  // DEPRECATED for primary UI spawning: Grid-based vehicle spawning
  // Currently preserved for:
  // - Testing particle systems and vehicle abilities  
  // - sprayWater() and other vehicle-specific abilities
  // - Performance testing with many vehicles (InstancedMesh)
  // Main application uses PathFollower vehicles for user interactions
  spawnAt(gx: number, gz: number, vehicleType?: VehicleType) {
    if (this.agents.length >= this.maxAgents) return;
    gx = clamp(Math.round(gx), 0, this.hm.width - 1);
    gz = clamp(Math.round(gz), 0, this.hm.height - 1);
    const wx = (gx + 0.5) * this.cellSize;
    const wz = (gz + 0.5) * this.cellSize;
    const y = this.hm.sample(wx, wz);

    const selectedVehicleType = vehicleType ?? this.getRandomVehicleType();

    if (selectedVehicleType === VehicleType.HELICOPTER || selectedVehicleType === VehicleType.AIRPLANE) {
      const altitude = selectedVehicleType === VehicleType.HELICOPTER ? 5 : 8;
      const posAir = new Vector3(wx, y + altitude, wz);
      const agent: Agent = {
        vehicleType: selectedVehicleType,
        pos: posAir,
        grid: { x: gx, z: gz },
        path: [{ x: gx, z: gz }],
        pathIdx: 0,
        speedTilesPerSec: this.getDefaultSpeed(selectedVehicleType),
        autoFollowRoad: false,
        altitude
      };
      agent.prevPos = posAir.clone();
      this.agents.push(agent);
      const current = this.vehicleCounts.get(selectedVehicleType) || 0;
      this.vehicleCounts.set(selectedVehicleType, current + 1);
      this.syncInstance(this.agents.length - 1);
      const inst = this.vehicleInstances.get(selectedVehicleType);
      if (inst) inst.instanceMatrix.needsUpdate = true;
      this.instVane.instanceMatrix.needsUpdate = true;
      return;
    }

    const pos = new Vector3(wx, y + 0.2, wz);
    // If roads exist, snap spawn to nearest road tile
    const spawnCell = this.findNearestRoad(gx, gz) ?? { x: gx, z: gz };
    const wx2 = (spawnCell.x + 0.5) * this.cellSize;
    const wz2 = (spawnCell.z + 0.5) * this.cellSize;
    const y2 = this.hm.sample(wx2, wz2);
    const pos2 = new Vector3(wx2, y2 + 0.22, wz2);

    const agent: Agent = {
      vehicleType: selectedVehicleType,
      pos: pos2,
      grid: spawnCell,
      path: [],
      pathIdx: 0,
      rotorAngle: 0,
      turnSignalLeft: 0,
      turnSignalRight: 0,
      speedTilesPerSec: this.getDefaultSpeed(selectedVehicleType),
      autoFollowRoad: true
      };
  
    agent.prevPos = pos2.clone();
    if (this.roadsVis) {
      const idx = this.roadsVis.findNearestPathIndex(pos2.x, pos2.z);
      if (idx >= 0) agent.pin = { pathIndex: idx };
    }
    const next = this.chooseNextRoadNeighbor(agent.grid, agent.prev);
    if (next) { agent.path = [agent.grid, next]; agent.pathIdx = 0; agent.prev = agent.grid; }
    this.agents.push(agent);

    const currentCount = this.vehicleCounts.get(selectedVehicleType) || 0;
    this.vehicleCounts.set(selectedVehicleType, currentCount + 1);

    this.syncInstance(this.agents.length - 1);

    const vehicleInstance = this.vehicleInstances.get(selectedVehicleType);
    if (vehicleInstance) {
      vehicleInstance.instanceMatrix.needsUpdate = true;
    }
    this.instVane.instanceMatrix.needsUpdate = true;
  }

  private getVehicleTypeIndex(vehicleType: VehicleType, agentIndex: number): number {
    // Count how many vehicles of this type exist before this agent
    let typeIndex = 0;
    for (let i = 0; i < agentIndex; i++) {
      if (this.agents[i].vehicleType === vehicleType) {
        typeIndex++;
      }
    }
    return typeIndex;
  }

  private getRandomVehicleType(): VehicleType {
    const vehicleTypes = Object.values(VehicleType);
    const randomIndex = Math.floor(Math.random() * vehicleTypes.length);
    return vehicleTypes[randomIndex];
  }

  private getDefaultSpeed(t: VehicleType): number {
    switch (t) {
      case VehicleType.BULLDOZER:
        return 1.5;
      case VehicleType.FIRETRUCK:
        return 2.5;
      case VehicleType.HELICOPTER:
        return 5;
      case VehicleType.AIRPLANE:
        return 7;
      case VehicleType.FIREFIGHTER:
        return 2.8;
      default:
        return 3.2;
    }
  }

  addLandingZone(gx: number, gz: number) {
    this.landingZones.push({ x: gx, z: gz });
  }

  private findNearestLandingZone(gx: number, gz: number): GridPoint | undefined {
    if (!this.landingZones.length) return undefined;
    let best: GridPoint | undefined;
    let bestD = Infinity;
    for (const lz of this.landingZones) {
      const dx = lz.x - gx;
      const dz = lz.z - gz;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD) { bestD = d2; best = lz; }
    }
    return best;
  }

  sprayWater(i: number, radius = 2, intensity = 0.5) {
    const a = this.agents[i];
    if (!a || a.vehicleType !== VehicleType.FIRETRUCK || !this.fireGrid) return;
    applyWaterAoE(this.fireGrid, a.grid, radius, intensity);
  }

  // DEPRECATED: Grid-based yaw mode calculation - only used in removed grid movement logic
  setYawMode(mode: 'grid' | 'midline' | 'velocity' | 'lookahead') { this.yawMode = mode; }
  setYawDebug(on: boolean) {
    this.yawDebugOn = on;
    if (on) {
      if (!this.yawArrow) {
        this.yawArrow = new ArrowHelper(new Vector3(1, 0, 0), new Vector3(0, 0, 0), this.cellSize * 1.2, 0xff0000);
        this.group.add(this.yawArrow);
      }
    } else {
      if (this.yawArrow) { this.group.remove(this.yawArrow); this.yawArrow = undefined; }
    }
  }
  setYawSmoothing(on: boolean) { this.smoothYaw = on; }
  getDebugText(i = 0): string {
    const a = this.agents[i];
    if (!a || !a.debug) return 'no agent/debug';
    const d = a.debug;
    const v = (o?: {x:number;y:number;z:number}) => o ? `${o.x.toFixed(3)},${o.y.toFixed(3)},${o.z.toFixed(3)}` : 'n/a';
    return [
      `yawMode=${d.yawMode} usedProj=${d.usedProj}`,
      `pos=(${v(d.pos)}) grid=(${d.grid.x},${d.grid.z}) pathIdx=${d.pathIdx}`,
      `fwd=(${v(d.fwd)}) up=(${v(d.up)}) right=(${v(d.right)})`,
      `terrN=(${v(d.terrN)}) lastTan=(${v(d.lastTan)}) pinPath=${d.pinPath ?? 'n/a'} pinSeg=${d.pinSeg ?? 'n/a'}`,
      d.note ?? ''
    ].join('\n');
  }

  clear() {
    this.agents.length = 0;
    // Reset all vehicle instance counts
    for (const vehicleInstance of this.vehicleInstances.values()) {
      vehicleInstance.count = 0 as any;
      vehicleInstance.instanceMatrix.needsUpdate = true;
    }
    // Reset vehicle type counts
    for (const vehicleType of Object.values(VehicleType)) {
      this.vehicleCounts.set(vehicleType, 0);
    }
    this.instVane.count = 0 as any;
    this.instVane.instanceMatrix.needsUpdate = true;
    this.instRotor.count = 0 as any;
    this.instHeadlight.count = 0 as any;
    this.instSignal.count = 0 as any;
    this.instFlasher.count = 0 as any;
    this.smokeParticles.killAll();
    this.dustParticles.killAll();
    this.waterParticles.killAll();
    this.externalEmitters.clear();
    this.instRotor.instanceMatrix.needsUpdate = true;
    this.instHeadlight.instanceMatrix.needsUpdate = true;
    this.instSignal.instanceMatrix.needsUpdate = true;
    this.instFlasher.instanceMatrix.needsUpdate = true;
  }

  // DEPRECATED: Grid-based pathfinding for vehicle destinations
  // Only preserved for testing particle systems and vehicle abilities
  // Main application uses Frenet vehicle system for actual movement
  setDestinationAll(gx: number, gz: number) {
    for (let i = 0; i < this.agents.length; i++) this.setDestination(i, gx, gz);
  }

  // DEPRECATED: Grid-based pathfinding for individual vehicle destination
  // Only preserved for testing - main application uses Frenet vehicles
  setDestination(i: number, gx: number, gz: number) {
    const a = this.agents[i];
    if (!a) return;
    a.autoFollowRoad = false; // explicit destination switches to path mode
    gx = clamp(Math.round(gx), 0, this.hm.width - 1);
    gz = clamp(Math.round(gz), 0, this.hm.height - 1);

    if (a.vehicleType === VehicleType.HELICOPTER || a.vehicleType === VehicleType.AIRPLANE) {
      const dest = this.findNearestLandingZone(gx, gz) ?? { x: gx, z: gz };
      a.path = [{ x: a.grid.x, z: a.grid.z }, dest];
      a.pathIdx = 0;
      a.prev = undefined;
      return;
    }

    const W = this.terrain.width;
    const H = this.terrain.height;
    const startRoad = this.findNearestRoad(a.grid.x, a.grid.z);
    const goalRoad = this.findNearestRoad(gx, gz);
    if (!startRoad || !goalRoad) return;
    if (startRoad.x !== a.grid.x || startRoad.z !== a.grid.z) {
      a.grid = { x: startRoad.x, z: startRoad.z };
      const wx = (a.grid.x + 0.5) * this.cellSize;
      const wz = (a.grid.z + 0.5) * this.cellSize;
      a.pos.set(wx, this.hm.sample(wx, wz) + 0.2, wz);
    }
    const field = {
      width: W,
      height: H,
      costAt: (x: number, z: number) => {
        return this.roadMask.mask[z * W + x] === 1 ? 1 : Infinity;
      }
    };
    const rawPath = aStarPath(field as any, startRoad, goalRoad, { diag: false, heuristic: 'euclid', maxIter: W * H * 6 });
    const path = makeAngularPath(rawPath);
    if (path.length) { a.path = path; a.pathIdx = 0; a.prev = undefined; }
  }

  private spawnParticlesFromVehicles(dt: number) {
    // Spawn particles from all active vehicles for visual testing
    // Rate limiting: spawn particles every ~100ms to avoid overwhelming the system
    const spawnInterval = 0.1; // seconds
    if (this.elapsed % spawnInterval < dt) {
      for (let i = 0; i < this.agents.length; i++) {
        const agent = this.agents[i];
        
        // Basic particle spawn position at vehicle location with slight randomization
        const pos = {
          x: agent.pos.x + (Math.random() - 0.5) * 0.3,
          y: agent.pos.y + 0.15, // Slightly above vehicle
          z: agent.pos.z + (Math.random() - 0.5) * 0.3
        };
        
        // Enhanced random velocity for better particle spread
        const vel = {
          x: (Math.random() - 0.5) * 2.5,
          y: Math.random() * 2.0 + 0.8,
          z: (Math.random() - 0.5) * 2.5
        };
        
        // Spawn different particles based on vehicle type with enhanced visibility
        switch (agent.vehicleType) {
          case VehicleType.FIRETRUCK:
            // Enhanced water spray particles (blue/white)
            this.waterParticles.spawnOne({
              pos,
              vel: { x: vel.x * 0.7, y: vel.y * 0.6, z: vel.z * 0.7 },
              life: 2.5,
              size0: this.cellSize * 0.08, // Larger initial size
              size1: this.cellSize * 0.2,  // Larger final size
              color0: [0.3, 0.6, 1.0], // Brighter blue
              color1: [0.9, 0.95, 1.0] // Bright white
            });
            break;
            
          case VehicleType.HELICOPTER:
          case VehicleType.AIRPLANE:
            // Enhanced smoke/exhaust particles (dark gray)
            this.smokeParticles.spawnOne({
              pos: { x: pos.x, y: pos.y + 0.4, z: pos.z }, // Higher for aircraft
              vel: { x: vel.x * 0.4, y: vel.y + 1.2, z: vel.z * 0.4 },
              life: 3.5,
              size0: this.cellSize * 0.06, // Larger initial size
              size1: this.cellSize * 0.25, // Larger final size
              color0: [0.2, 0.2, 0.2], // Darker initial
              color1: [0.7, 0.7, 0.7]  // Lighter final
            });
            break;
            
          case VehicleType.CAR:
          case VehicleType.BULLDOZER:
          case VehicleType.FIREFIGHTER:
          default:
            // Enhanced dust particles (tan/brown)
            this.dustParticles.spawnOne({
              pos,
              vel: { x: vel.x * 0.4, y: vel.y * 0.4, z: vel.z * 0.4 },
              life: 2.0,
              size0: this.cellSize * 0.05, // Larger initial size
              size1: this.cellSize * 0.15, // Larger final size
              color0: [0.9, 0.7, 0.5], // Brighter tan
              color1: [0.6, 0.4, 0.2]  // Brown
            });
            break;
        }
      }
    }
  }

  update(dt: number) {
    // DEPRECATED: Grid-based vehicle movement removed in favor of Frenet vehicles
    // Only particle system updates are preserved for testing and backwards compatibility
    this.elapsed += dt;
    this.lastDt = dt;
    
    // Reset counters (no longer used for grid vehicles)
    this.headlightCount = 0;
    this.signalCount = 0;
    this.flasherCount = 0;
    
    // Grid-based movement logic removed - now using Frenet vehicles in main application
    // The old logic included pathfinding, intersection handling, and agent movement
    // Tests may still spawn static agents via spawnAt() for particle testing
    
    // Spawn particles from vehicles for testing/demo purposes
    this.spawnParticlesFromVehicles(dt);
    
    // Update particle systems only
    this.smokeParticles.update(dt, { wx: 0, wz: 0 }, 0);
    this.dustParticles.update(dt, { wx: 0, wz: 0 }, 0);
    this.waterParticles.update(dt, { wx: 0, wz: 0 }, 0);
  }

  updateExternalFx(
    dt: number,
    states: ReadonlyArray<VehicleFxState>,
    opts: { wind?: { wx: number; wz: number } } = {}
  ) {
    this.elapsed += dt;
    const wind = opts.wind ?? { wx: 0, wz: 0 };

    this.headlightCount = 0;
    this.signalCount = 0;
    this.flasherCount = 0;

    for (const record of this.externalEmitters.values()) record.active = false;

    const flasherMat = this.instFlasher.material as MeshStandardMaterial;
    const cycle = Math.sin(this.elapsed * 6);
    const red = Math.max(0, cycle);
    const blue = Math.max(0, -cycle);
    flasherMat.color.setRGB(0.25 + red * 0.75, 0.1, 0.25 + blue * 0.75);
    flasherMat.emissive.setRGB(0.4 + red * 1.8, 0.1, 0.4 + blue * 1.8);
    flasherMat.emissiveIntensity = 0.9 + Math.abs(cycle) * 1.6;

    const headMat = this.instHeadlight.material as MeshStandardMaterial;
    headMat.emissiveIntensity = 1.2 + 0.3 * Math.sin(this.elapsed * 2.5);

    for (const state of states) {
      let record = this.externalEmitters.get(state.id);
      if (!record) {
        record = { dustAcc: 0, waterAcc: 0, active: true };
        this.externalEmitters.set(state.id, record);
      } else {
        record.active = true;
      }

      const isGround = state.type !== VehicleType.HELICOPTER && state.type !== VehicleType.AIRPLANE;
      if (isGround) {
        const front = this.cellSize * 0.5;
        const side = this.cellSize * 0.28;
        this.tmpVec
          .copy(state.pos)
          .addScaledVector(state.up, this.cellSize * 0.25)
          .addScaledVector(state.forward, front);

        this.tmpObj3.position.copy(this.tmpVec).addScaledVector(state.right, -side);
        this.tmpObj3.quaternion.identity();
        this.tmpObj3.updateMatrix();
        this.instHeadlight.setMatrixAt(this.headlightCount++, this.tmpObj3.matrix as Matrix4);

        this.tmpObj3.position.copy(this.tmpVec).addScaledVector(state.right, side);
        this.tmpObj3.updateMatrix();
        this.instHeadlight.setMatrixAt(this.headlightCount++, this.tmpObj3.matrix as Matrix4);

        const dustRate = Math.max(0, state.speed) * 1.25;
        record.dustAcc += dustRate * dt;
        while (record.dustAcc >= 1) {
          const jitterSide = (Math.random() - 0.5) * this.cellSize * 0.6;
          const jitterForward = -(0.35 + Math.random() * 0.35) * this.cellSize;
          this.tmpVec2
            .copy(state.pos)
            .addScaledVector(state.up, this.cellSize * 0.12 + Math.random() * this.cellSize * 0.05)
            .addScaledVector(state.forward, jitterForward)
            .addScaledVector(state.right, jitterSide);
          const vel = {
            x: state.forward.x * 0.4 + (Math.random() - 0.5) * 1.1,
            y: 0.45 + Math.random() * 0.6,
            z: state.forward.z * 0.4 + (Math.random() - 0.5) * 1.1,
          };
          this.dustParticles.spawnOne({
            pos: { x: this.tmpVec2.x, y: this.tmpVec2.y, z: this.tmpVec2.z },
            vel,
            life: 1.4 + Math.random() * 0.6,
            size0: this.cellSize * (0.045 + Math.random() * 0.035),
            size1: this.cellSize * (0.12 + Math.random() * 0.08),
            color0: [0.82, 0.7, 0.52],
            color1: [0.55, 0.44, 0.32],
          });
          record.dustAcc -= 1;
        }
      } else {
        record.dustAcc = 0;
      }

      if (state.type === VehicleType.FIRETRUCK) {
        const sirenBase = this.tmpVec.copy(state.pos).addScaledVector(state.up, this.cellSize * 0.55);
        const sirenOffset = this.cellSize * 0.24;
        this.tmpObj3.position.copy(sirenBase).addScaledVector(state.right, -sirenOffset);
        this.tmpObj3.quaternion.identity();
        this.tmpObj3.updateMatrix();
        this.instFlasher.setMatrixAt(this.flasherCount++, this.tmpObj3.matrix as Matrix4);
        this.tmpObj3.position.copy(sirenBase).addScaledVector(state.right, sirenOffset);
        this.tmpObj3.updateMatrix();
        this.instFlasher.setMatrixAt(this.flasherCount++, this.tmpObj3.matrix as Matrix4);

        if (state.sprayingWater) {
          const waterRate = 14;
          record.waterAcc += waterRate * dt;
          while (record.waterAcc >= 1) {
            const jitterSide = (Math.random() - 0.5) * this.cellSize * 0.25;
            this.tmpVec3
              .copy(state.pos)
              .addScaledVector(state.up, this.cellSize * 0.3)
              .addScaledVector(state.forward, this.cellSize * (0.9 + Math.random() * 0.25))
              .addScaledVector(state.right, jitterSide);
            const vel = {
              x: state.forward.x * 3.2 + (Math.random() - 0.5) * 1.4,
              y: 2.6 + Math.random() * 0.9,
              z: state.forward.z * 3.2 + (Math.random() - 0.5) * 1.4,
            };
            this.waterParticles.spawnOne({
              pos: { x: this.tmpVec3.x, y: this.tmpVec3.y, z: this.tmpVec3.z },
              vel,
              life: 1.1 + Math.random() * 0.5,
              size0: this.cellSize * (0.05 + Math.random() * 0.03),
              size1: this.cellSize * (0.08 + Math.random() * 0.05),
              color0: [0.4, 0.62, 0.95],
              color1: [0.85, 0.94, 1.0],
            });
            record.waterAcc -= 1;
          }
        } else {
          record.waterAcc = 0;
        }
      } else {
        record.waterAcc = 0;
      }
    }

    for (const [fxId, record] of this.externalEmitters.entries()) {
      if (!record.active) this.externalEmitters.delete(fxId);
    }

    this.instHeadlight.count = this.headlightCount as any;
    this.instSignal.count = 0 as any;
    this.instFlasher.count = this.flasherCount as any;
    this.instHeadlight.instanceMatrix.needsUpdate = true;
    this.instSignal.instanceMatrix.needsUpdate = true;
    this.instFlasher.instanceMatrix.needsUpdate = true;

    this.dustParticles.update(dt, wind, 0);
    this.waterParticles.update(dt, wind, 0);
    this.smokeParticles.update(dt, wind, 0);
  }

  private syncInstance(i: number) {
    const a = this.agents[i];
    this.tmpObj.position.copy(a.pos);
    // Build oriented basis aligned to terrain normal and movement direction
      const up = (a.vehicleType === VehicleType.HELICOPTER || a.vehicleType === VehicleType.AIRPLANE)
        ? new Vector3(0, 1, 0)
        : (a.lastProj?.normal ?? this.terrainNormal(a.pos.x, a.pos.z));
    let fwd = new Vector3(0, 0, 1);
    // Helper to set path segment direction
    const setPathDir = () => {
      if (a.path.length - 1 > a.pathIdx) {
        const cur = a.path[a.pathIdx];
        const nxt = a.path[a.pathIdx + 1];
        fwd.set(nxt.x - cur.x, 0, nxt.z - cur.z);
        return true;
      }
      return false;
    };
    // Choose forward vector with robust fallbacks per mode
    if (this.yawMode === 'midline') {
      if (a.lastProj?.tangent) fwd.copy(a.lastProj.tangent);
      else if (!setPathDir()) {
        if (a.prevPos) fwd.set(a.pos.x - a.prevPos.x, 0, a.pos.z - a.prevPos.z);
      }
    } else if (this.yawMode === 'grid') {
      if (!setPathDir()) {
        if (a.lastProj?.tangent) fwd.copy(a.lastProj.tangent);
        else if (a.prevPos) fwd.set(a.pos.x - a.prevPos.x, 0, a.pos.z - a.prevPos.z);
      }
    } else if (this.yawMode === 'velocity') {
      if (a.prevPos) fwd.set(a.pos.x - a.prevPos.x, 0, a.pos.z - a.prevPos.z);
      if (fwd.lengthSq() < 1e-8) {
        if (a.lastProj?.tangent) fwd.copy(a.lastProj.tangent);
        else setPathDir();
      }
    } else if (this.yawMode === 'lookahead') {
      if (a.path.length - 1 > a.pathIdx) {
        const cur = a.path[a.pathIdx];
        const nxt = a.path[Math.min(a.pathIdx + 1, a.path.length - 1)];
        const nxt2 = a.path[Math.min(a.pathIdx + 2, a.path.length - 1)];
        const dx1 = (nxt.x - cur.x), dz1 = (nxt.z - cur.z);
        const dx2 = (nxt2.x - nxt.x), dz2 = (nxt2.z - nxt.z);
        fwd.set(dx1 + 0.7 * dx2, 0, dz1 + 0.7 * dz2);
      }
      if (fwd.lengthSq() < 1e-8) {
        if (a.lastProj?.tangent) fwd.copy(a.lastProj.tangent);
        else if (!setPathDir() && a.prevPos) fwd.set(a.pos.x - a.prevPos.x, 0, a.pos.z - a.prevPos.z);
      }
    }
    const fwdPreLen = Math.sqrt(fwd.lengthSq());
    if (fwdPreLen < 1e-12) fwd.set(0, 0, 1);
    fwd.normalize();
    // Project forward onto terrain plane
    const right = new Vector3().crossVectors(fwd, up);
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
    right.normalize();
    fwd = new Vector3().crossVectors(up, right).normalize();
    // Target orientation quaternion and smoothing (slerp)
    const m = new Matrix4().makeBasis(right, up, fwd);
    const targetQ = new Quaternion().setFromRotationMatrix(m);
    const tau = 0.12; // seconds
    const alpha = this.smoothYaw ? (1 - Math.exp(-(this.lastDt || 0) / tau)) : 1;
    if (!a.prevQuat) a.prevQuat = targetQ.clone();
    a.prevQuat.slerp(targetQ, alpha);
    // Capture debug snapshot
    const copy = (v: Vector3) => ({ x: +v.x.toFixed(6), y: +v.y.toFixed(6), z: +v.z.toFixed(6) });
    const showDir = new Vector3(0, 0, 1).applyQuaternion(a.prevQuat);
    const yawDeg = Math.atan2(showDir.x, showDir.z) * 180 / Math.PI;
    const tanDot = a.lastProj?.tangent ? (a.lastProj.tangent.x * showDir.x + a.lastProj.tangent.z * showDir.z) : undefined;
    a.debug = {
      yawMode: this.yawMode,
      usedProj: !!a.lastProj,
      fwd: copy(showDir),
      up: copy(up),
      right: copy(right),
      pinPath: a.pin?.pathIndex,
      pinSeg: a.pin?.segIndex,
      lastTan: a.lastProj ? copy(a.lastProj.tangent) : undefined,
      terrN: copy(this.terrainNormal(a.pos.x, a.pos.z)),
      pathIdx: a.pathIdx,
      grid: { x: a.grid.x, z: a.grid.z },
      pos: { x: +a.pos.x.toFixed(3), y: +a.pos.y.toFixed(3), z: +a.pos.z.toFixed(3) },
      note: `fwdPreLen=${fwdPreLen.toFixed(5)} rightLen=${Math.sqrt(right.lengthSq()).toFixed(5)} yawDeg=${yawDeg.toFixed(1)} tanDot=${tanDot!=null?tanDot.toFixed(3):'n/a'}`,
    };

    // Construct rotation matrix columns (right, up, forward)
    this.tmpObj.quaternion.copy(a.prevQuat);
    this.tmpObj.updateMatrix();
    
    // Get the appropriate vehicle instance for this agent
    const vehicleInstance = this.vehicleInstances.get(a.vehicleType);
    if (vehicleInstance) {
      // Find the index for this vehicle type
      const typeIndex = this.getVehicleTypeIndex(a.vehicleType, i);
      vehicleInstance.setMatrixAt(typeIndex, this.tmpObj.matrix as Matrix4);
      vehicleInstance.count = Math.max(vehicleInstance.count as any as number, typeIndex + 1) as any;
    }

    // Rotor for helicopters
    if (a.vehicleType === VehicleType.HELICOPTER) {
      const hIdx = this.getVehicleTypeIndex(VehicleType.HELICOPTER, i);
      this.tmpObj3.position.copy(a.pos).addScaledVector(up, this.cellSize * 0.35);
      this.tmpObj3.quaternion.copy(this.tmpObj.quaternion);
      this.tmpObj3.rotateY(a.rotorAngle ?? 0);
      this.tmpObj3.updateMatrix();
      this.instRotor.setMatrixAt(hIdx, this.tmpObj3.matrix as Matrix4);
      this.instRotor.count = Math.max(this.instRotor.count as any as number, hIdx + 1) as any;
    }

    // Lights (headlights, turn signals, flashers)
    if (a.vehicleType === VehicleType.CAR || a.vehicleType === VehicleType.FIRETRUCK) {
      const front = this.cellSize * 0.5;
      const side = this.cellSize * 0.25;
      const base = a.pos.clone().addScaledVector(up, this.cellSize * 0.15).addScaledVector(fwd, front);
      // headlights
      this.tmpObj3.position.copy(base).addScaledVector(right, -side);
      this.tmpObj3.quaternion.identity();
      this.tmpObj3.updateMatrix();
      this.instHeadlight.setMatrixAt(this.headlightCount++, this.tmpObj3.matrix as Matrix4);
      this.tmpObj3.position.copy(base).addScaledVector(right, side);
      this.tmpObj3.updateMatrix();
      this.instHeadlight.setMatrixAt(this.headlightCount++, this.tmpObj3.matrix as Matrix4);
      // turn signals
      const sigBase = a.pos.clone().addScaledVector(up, this.cellSize * 0.15).addScaledVector(fwd, front - this.cellSize * 0.05);
      if (a.turnSignalLeft && a.turnSignalLeft > 0) {
        this.tmpObj3.position.copy(sigBase).addScaledVector(right, -side);
        this.tmpObj3.updateMatrix();
        this.instSignal.setMatrixAt(this.signalCount++, this.tmpObj3.matrix as Matrix4);
      }
      if (a.turnSignalRight && a.turnSignalRight > 0) {
        this.tmpObj3.position.copy(sigBase).addScaledVector(right, side);
        this.tmpObj3.updateMatrix();
        this.instSignal.setMatrixAt(this.signalCount++, this.tmpObj3.matrix as Matrix4);
      }
      if (a.vehicleType === VehicleType.FIRETRUCK) {
        const flasherOn = (Math.floor(this.elapsed * 4) % 2) === 0;
        if (flasherOn) {
          this.tmpObj3.position.copy(a.pos).addScaledVector(up, this.cellSize * 0.45);
          this.tmpObj3.quaternion.identity();
          this.tmpObj3.updateMatrix();
          this.instFlasher.setMatrixAt(this.flasherCount++, this.tmpObj3.matrix as Matrix4);
        }
      }
    }

    // Vane: place a small marker above and slightly ahead to visualize yaw clearly
    this.tmpObj2.position
      .copy(a.pos)
      .addScaledVector(up, this.cellSize * 0.35)
      .addScaledVector(fwd, this.cellSize * 0.4);
    this.tmpObj2.quaternion.copy(this.tmpObj.quaternion);
    this.tmpObj2.scale.set(0.6, 1.0, 0.6);
    this.tmpObj2.updateMatrix();
    this.instVane.setMatrixAt(i, this.tmpObj2.matrix as Matrix4);
    this.instVane.count = Math.max(this.instVane.count as any as number, i + 1) as any;

    // Update debug arrow for one agent if enabled
    if (this.yawDebugOn && this.yawArrow && i === this.yawDebugIndex) {
      const pos = a.pos.clone().addScaledVector(up, this.cellSize * 0.6);
      this.yawArrow.position.copy(pos);
      const dir = new Vector3(0, 0, 1).applyQuaternion(a.prevQuat);
      this.yawArrow.setDirection(new Vector3(dir.x, 0, dir.z).normalize());
      this.yawArrow.setLength(this.cellSize * 1.5);
    }
  }

  private terrainNormal(wx: number, wz: number): Vector3 {
    const e = this.cellSize * 0.5;
    const hL = this.hm.sample(wx - e, wz);
    const hR = this.hm.sample(wx + e, wz);
    const hD = this.hm.sample(wx, wz - e);
    const hU = this.hm.sample(wx, wz + e);
    const dhdx = (hR - hL) / (2 * e);
    const dhdz = (hU - hD) / (2 * e);
    const n = new Vector3(-dhdx, 1, -dhdz);
    n.normalize();
    return n;
  }

  private cellKey(g: GridPoint): string {
    return `${g.x},${g.z}`;
  }

  private isIntersection(g: GridPoint): boolean {
    const W = this.terrain.width, H = this.terrain.height;
    let count = 0;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dz) continue;
      const nx = g.x + dx, nz = g.z + dz;
      if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue;
      if (this.roadMask.mask[nz * W + nx] === 1) count++;
    }
    return count > 2;
  }

  private canEnterIntersection(i: number, next: GridPoint, dt: number): boolean {
    const a = this.agents[i];
    const key = this.cellKey(next);
    if (a.intersection === key) return true;
    let queue = this.intersectionQueues.get(key);
    if (!queue) { queue = []; this.intersectionQueues.set(key, queue); }
    const occupant = this.intersectionOccupants.get(key);
    if (!a.waitingFor || a.waitingFor !== key) {
      a.waitingFor = key;
      a.stopTimer = this.stopDuration;
      if (!queue.includes(i)) queue.push(i);
      return false;
    }
    if (a.stopTimer != null && a.stopTimer > 0) {
      a.stopTimer -= dt;
      return false;
    }
    if (occupant != null && occupant !== i) {
      if (!queue.includes(i)) queue.push(i);
      return false;
    }
    if (queue.length && queue[0] !== i) {
      if (!queue.includes(i)) queue.push(i);
      return false;
    }
    if (queue.length && queue[0] === i) queue.shift();
    this.intersectionOccupants.set(key, i);
    a.intersection = key;
    a.waitingFor = undefined;
    return true;
  }

  private releaseIntersection(a: Agent) {
    if (!a.intersection) return;
    const [ix, iz] = a.intersection.split(',').map(Number);
    if (a.grid.x !== ix || a.grid.z !== iz) {
      this.intersectionOccupants.delete(a.intersection);
      const q = this.intersectionQueues.get(a.intersection);
      if (q && q.length === 0) this.intersectionQueues.delete(a.intersection);
      a.intersection = undefined;
    }
  }

  private chooseNextRoadNeighbor(cur: GridPoint, prev?: GridPoint, tangent?: Vector3): GridPoint | undefined {
    const W = this.terrain.width, H = this.terrain.height;
    const x = cur.x, z = cur.z;
    const neigh4: GridPoint[] = [];
    const neigh8: GridPoint[] = [];
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dz) continue;
      const nx = x + dx, nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue;
      if (this.roadMask.mask[nz * W + nx] !== 1) continue;
      if (prev && nx === prev.x && nz === prev.z) continue;
      const isDiag = dx !== 0 && dz !== 0;
      (isDiag ? neigh8 : neigh4).push({ x: nx, z: nz });
    }
    const neigh = neigh4.length ? neigh4 : neigh8;
    if (!neigh.length) {
      // dead end: allow going back if prev exists
      if (prev) return { x: prev.x, z: prev.z };
      return undefined;
    }
    if (neigh.length === 1) return neigh[0];
    // If we have a projected tangent from the road midline, follow the neighbor most aligned with it
    if (tangent) {
      let best: GridPoint | undefined;
      let bestDot = -Infinity;
      for (const n of neigh) {
        const dx = n.x - x, dz = n.z - z;
        const denom = Math.hypot(dx, dz) * Math.hypot(tangent.x, tangent.z);
        const dot = (dx * tangent.x + dz * tangent.z) / (denom === 0 ? 1 : denom);
        if (dot > bestDot) { bestDot = dot; best = n; }
      }
      if (best) return best;
    }
    // If we don't have a previous direction, choose the neighbor with the strongest continuation (highest road degree)
    const roadDegree = (cx: number, cz: number, ex?: number, ez?: number) => {
      let d = 0;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const nx = cx + dx, nz = cz + dz;
        if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue;
        if (ex != null && ez != null && nx === ex && nz === ez) continue;
        if (this.roadMask.mask[nz * W + nx] === 1) d++;
      }
      return d;
    };
    if (!prev) {
      let bestN: GridPoint | undefined;
      let bestD = -1;
      for (const n of neigh) {
        const d = roadDegree(n.x, n.z, x, z);
        if (d > bestD) { bestD = d; bestN = n; }
      }
      if (bestN) return bestN;
    }
    // Otherwise, prefer least turning angle relative to incoming vector
    let best: GridPoint | undefined;
    let bestScore = -Infinity;
    let vx = 0, vz = 1;
    if (prev) { vx = x - prev.x; vz = z - prev.z; }
    for (const n of neigh) {
      const dx = n.x - x, dz = n.z - z;
      const dot = (dx * vx + dz * vz) / (Math.hypot(dx, dz) * Math.hypot(vx, vz) || 1);
      const score = dot; // larger is straighter
      if (score > bestScore) { bestScore = score; best = n; }
    }
    return best;
  }

  private findNearestRoad(gx: number, gz: number): GridPoint | undefined {
    const W = this.terrain.width, H = this.terrain.height;
    if (this.roadMask.mask[gz * W + gx] === 1) return { x: gx, z: gz };
    const maxR = Math.max(W, H);
    for (let r = 1; r < maxR; r++) {
      for (let dz = -r; dz <= r; dz++) {
        const nz = gz + dz; if (nz < 0 || nz >= H) continue;
        const nx1 = gx - r; if (nx1 >= 0 && nx1 < W && this.roadMask.mask[nz * W + nx1] === 1) return { x: nx1, z: nz };
        const nx2 = gx + r; if (nx2 >= 0 && nx2 < W && this.roadMask.mask[nz * W + nx2] === 1) return { x: nx2, z: nz };
      }
      for (let dx = -r + 1; dx <= r - 1; dx++) {
        const nx = gx + dx; if (nx < 0 || nx >= W) continue;
        const nz1 = gz - r; if (nz1 >= 0 && nz1 < H && this.roadMask.mask[nz1 * W + nx] === 1) return { x: nx, z: nz1 };
        const nz2 = gz + r; if (nz2 >= 0 && nz2 < H && this.roadMask.mask[nz2 * W + nx] === 1) return { x: nx, z: nz2 };
      }
    }
    return undefined;
  }
}

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }
