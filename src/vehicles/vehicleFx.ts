import { Vector3 } from 'three';
import type { InstancedMesh, MeshStandardMaterial, Object3D } from 'three';
import type { InstancedParticleSystem } from '../particles/system';
import { VehicleType, type VehicleFxState } from './types';

export type ParticleAgent = {
  vehicleType: VehicleType;
  pos: Vector3;
};

export type ParticleSpawnContext = {
  cellSize: number;
  waterParticles: InstancedParticleSystem;
  smokeParticles: InstancedParticleSystem;
  dustParticles: InstancedParticleSystem;
};

export type ExternalEmitterState = { dustAcc: number; waterAcc: number; active: boolean };

export type ExternalFxContext = {
  cellSize: number;
  instHeadlight: InstancedMesh;
  instSignal: InstancedMesh;
  instFlasher: InstancedMesh;
  dustParticles: InstancedParticleSystem;
  waterParticles: InstancedParticleSystem;
  smokeParticles: InstancedParticleSystem;
  tmpObj3: Object3D;
  tmpVec: Vector3;
  tmpVec2: Vector3;
  tmpVec3: Vector3;
  externalEmitters: Map<number, ExternalEmitterState>;
};

export function spawnParticlesFromVehicles(ctx: ParticleSpawnContext, agents: ParticleAgent[], dt: number, elapsed: number) {
  const spawnInterval = 0.1;
  if (elapsed % spawnInterval >= dt) return;

  for (const agent of agents) {
    const pos = {
      x: agent.pos.x + (Math.random() - 0.5) * 0.3,
      y: agent.pos.y + 0.15,
      z: agent.pos.z + (Math.random() - 0.5) * 0.3
    };
    const vel = {
      x: (Math.random() - 0.5) * 2.5,
      y: Math.random() * 2.0 + 0.8,
      z: (Math.random() - 0.5) * 2.5
    };

    switch (agent.vehicleType) {
      case VehicleType.FIRETRUCK:
        ctx.waterParticles.spawnOne({
          pos,
          vel: { x: vel.x * 0.7, y: vel.y * 0.6, z: vel.z * 0.7 },
          life: 2.5,
          size0: ctx.cellSize * 0.08,
          size1: ctx.cellSize * 0.2,
          color0: [0.3, 0.6, 1.0],
          color1: [0.9, 0.95, 1.0]
        });
        break;
      case VehicleType.HELICOPTER:
      case VehicleType.AIRPLANE:
        ctx.smokeParticles.spawnOne({
          pos: { x: pos.x, y: pos.y + 0.4, z: pos.z },
          vel: { x: vel.x * 0.4, y: vel.y + 1.2, z: vel.z * 0.4 },
          life: 3.5,
          size0: ctx.cellSize * 0.06,
          size1: ctx.cellSize * 0.25,
          color0: [0.2, 0.2, 0.2],
          color1: [0.7, 0.7, 0.7]
        });
        break;
      case VehicleType.CAR:
      case VehicleType.BULLDOZER:
      case VehicleType.FIREFIGHTER:
      default:
        ctx.dustParticles.spawnOne({
          pos,
          vel: { x: vel.x * 0.4, y: vel.y * 0.4, z: vel.z * 0.4 },
          life: 2.0,
          size0: ctx.cellSize * 0.05,
          size1: ctx.cellSize * 0.15,
          color0: [0.9, 0.7, 0.5],
          color1: [0.6, 0.4, 0.2]
        });
        break;
    }
  }
}

export function updateExternalFx(
  ctx: ExternalFxContext,
  dt: number,
  elapsed: number,
  states: ReadonlyArray<VehicleFxState>,
  opts: { wind?: { wx: number; wz: number } } = {}
) {
  const wind = opts.wind ?? { wx: 0, wz: 0 };
  let headlightCount = 0;
  let signalCount = 0;
  let flasherCount = 0;

  for (const record of ctx.externalEmitters.values()) record.active = false;

  const flasherMat = ctx.instFlasher.material as MeshStandardMaterial;
  const cycle = Math.sin(elapsed * 6);
  const red = Math.max(0, cycle);
  const blue = Math.max(0, -cycle);
  flasherMat.color.setRGB(0.25 + red * 0.75, 0.1, 0.25 + blue * 0.75);
  flasherMat.emissive.setRGB(0.4 + red * 1.8, 0.1, 0.4 + blue * 1.8);
  flasherMat.emissiveIntensity = 0.9 + Math.abs(cycle) * 1.6;

  const headMat = ctx.instHeadlight.material as MeshStandardMaterial;
  headMat.emissiveIntensity = 1.2 + 0.3 * Math.sin(elapsed * 2.5);

  for (const state of states) {
    let record = ctx.externalEmitters.get(state.id);
    if (!record) {
      record = { dustAcc: 0, waterAcc: 0, active: true };
      ctx.externalEmitters.set(state.id, record);
    } else {
      record.active = true;
    }

    const isGround = state.type !== VehicleType.HELICOPTER && state.type !== VehicleType.AIRPLANE;
    if (isGround) {
      const front = ctx.cellSize * 0.5;
      const side = ctx.cellSize * 0.28;
      ctx.tmpVec
        .copy(state.pos)
        .addScaledVector(state.up, ctx.cellSize * 0.25)
        .addScaledVector(state.forward, front);

      ctx.tmpObj3.position.copy(ctx.tmpVec).addScaledVector(state.right, -side);
      ctx.tmpObj3.quaternion.identity();
      ctx.tmpObj3.updateMatrix();
      ctx.instHeadlight.setMatrixAt(headlightCount++, ctx.tmpObj3.matrix as any);

      ctx.tmpObj3.position.copy(ctx.tmpVec).addScaledVector(state.right, side);
      ctx.tmpObj3.updateMatrix();
      ctx.instHeadlight.setMatrixAt(headlightCount++, ctx.tmpObj3.matrix as any);

      const dustRate = Math.max(0, state.speed) * 1.25;
      record.dustAcc += dustRate * dt;
      while (record.dustAcc >= 1) {
        const jitterSide = (Math.random() - 0.5) * ctx.cellSize * 0.6;
        const jitterForward = -(0.35 + Math.random() * 0.35) * ctx.cellSize;
        ctx.tmpVec2
          .copy(state.pos)
          .addScaledVector(state.up, ctx.cellSize * 0.12 + Math.random() * ctx.cellSize * 0.05)
          .addScaledVector(state.forward, jitterForward)
          .addScaledVector(state.right, jitterSide);
        const vel = {
          x: state.forward.x * 0.4 + (Math.random() - 0.5) * 1.1,
          y: 0.45 + Math.random() * 0.6,
          z: state.forward.z * 0.4 + (Math.random() - 0.5) * 1.1,
        };
        ctx.dustParticles.spawnOne({
          pos: { x: ctx.tmpVec2.x, y: ctx.tmpVec2.y, z: ctx.tmpVec2.z },
          vel,
          life: 1.4 + Math.random() * 0.6,
          size0: ctx.cellSize * (0.045 + Math.random() * 0.035),
          size1: ctx.cellSize * (0.12 + Math.random() * 0.08),
          color0: [0.82, 0.7, 0.52],
          color1: [0.55, 0.44, 0.32],
        });
        record.dustAcc -= 1;
      }
    } else {
      record.dustAcc = 0;
    }

    if (state.type === VehicleType.FIRETRUCK) {
      const sirenBase = ctx.tmpVec.copy(state.pos).addScaledVector(state.up, ctx.cellSize * 0.55);
      const sirenOffset = ctx.cellSize * 0.24;
      ctx.tmpObj3.position.copy(sirenBase).addScaledVector(state.right, -sirenOffset);
      ctx.tmpObj3.quaternion.identity();
      ctx.tmpObj3.updateMatrix();
      ctx.instFlasher.setMatrixAt(flasherCount++, ctx.tmpObj3.matrix as any);
      ctx.tmpObj3.position.copy(sirenBase).addScaledVector(state.right, sirenOffset);
      ctx.tmpObj3.updateMatrix();
      ctx.instFlasher.setMatrixAt(flasherCount++, ctx.tmpObj3.matrix as any);

      if (state.sprayingWater) {
        // Sweep the hose left/right like a sprinkler
        const sweepAngle = Math.sin(elapsed * 1.8) * (Math.PI / 4); // +/-45°
        const sweepDir = new Vector3().copy(state.forward).applyAxisAngle(state.up, sweepAngle).normalize();
        const waterRate = 30;
        record.waterAcc += waterRate * dt;
        if (record.waterAcc < 1) record.waterAcc = 1;
        while (record.waterAcc >= 1) {
          const jitterSide = (Math.random() - 0.5) * ctx.cellSize * 0.25;
          ctx.tmpVec3
            .copy(state.pos)
            .addScaledVector(state.up, ctx.cellSize * 0.3)
            .addScaledVector(sweepDir, ctx.cellSize * (0.9 + Math.random() * 0.25))
            .addScaledVector(state.right, jitterSide);
          const vel = {
            x: sweepDir.x * 3.2 + (Math.random() - 0.5) * 1.4,
            y: 3.2 + Math.random() * 0.9,
            z: sweepDir.z * 3.2 + (Math.random() - 0.5) * 1.4,
          };
          ctx.waterParticles.spawnOne({
            pos: { x: ctx.tmpVec3.x, y: ctx.tmpVec3.y, z: ctx.tmpVec3.z },
            vel,
            life: 2.0 + Math.random() * 0.6,
            size0: ctx.cellSize * (0.08 + Math.random() * 0.04),
            size1: ctx.cellSize * (0.14 + Math.random() * 0.06),
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

  for (const [fxId, record] of ctx.externalEmitters.entries()) {
    if (!record.active) ctx.externalEmitters.delete(fxId);
  }

  ctx.instHeadlight.count = headlightCount as any;
  ctx.instSignal.count = signalCount as any;
  ctx.instFlasher.count = flasherCount as any;
  ctx.instHeadlight.instanceMatrix.needsUpdate = true;
  ctx.instSignal.instanceMatrix.needsUpdate = true;
  ctx.instFlasher.instanceMatrix.needsUpdate = true;

  ctx.dustParticles.update(dt, wind, 0);
  ctx.waterParticles.update(dt, wind, 0);
  ctx.smokeParticles.update(dt, wind, 0);

  return { headlightCount, signalCount, flasherCount };
}
