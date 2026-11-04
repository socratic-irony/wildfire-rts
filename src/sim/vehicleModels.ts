import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  SphereGeometry,
} from 'three';

export type UnitKind = 'firetruck' | 'dozer' | 'helicopter' | 'tanker';

export interface VehicleModel {
  group: Group;
  rotor: Object3D | null;
  tailRotor: Object3D | null;
  redLight: MeshStandardMaterial | null;
  blueLight: MeshStandardMaterial | null;
}

function mat(color: number, options: Partial<{ roughness: number; metalness: number; emissive: number }> = {}): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color,
    roughness: options.roughness ?? 0.64,
    metalness: options.metalness ?? 0.12,
    emissive: options.emissive ?? 0x000000,
    flatShading: true,
  });
}

function box(
  width: number,
  height: number,
  depth: number,
  material: MeshStandardMaterial,
  x = 0,
  y = 0,
  z = 0,
): Mesh {
  const mesh = new Mesh(new BoxGeometry(width, height, depth), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  return mesh;
}

function wheel(material: MeshStandardMaterial, x: number, y: number, z: number, radius = 0.27): Mesh {
  const mesh = new Mesh(new CylinderGeometry(radius, radius, 0.2, 8), material);
  mesh.rotation.z = Math.PI / 2;
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  return mesh;
}

function lamp(color: number, emissive: number): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color,
    emissive,
    emissiveIntensity: 1.3,
    roughness: 0.32,
    metalness: 0.05,
    flatShading: true,
  });
}


export function createVehicleModel(kind: UnitKind): VehicleModel {
  const group = new Group();
  group.name = `vehicle-${kind}`;
  let rotor: Object3D | null = null;
  let tailRotor: Object3D | null = null;
  let redLight: MeshStandardMaterial | null = null;
  let blueLight: MeshStandardMaterial | null = null;
  const tire = mat(0x1c1f1c, { roughness: 0.92, metalness: 0.02 });
  const dark = mat(0x252a27, { roughness: 0.8 });
  const glass = mat(0x2c4653, { roughness: 0.24, metalness: 0.2 });

  if (kind === 'firetruck') {
    const red = mat(0xa92f28, { roughness: 0.52 });
    const white = mat(0xe8e2d1, { roughness: 0.6 });
    const silver = mat(0xa7b1af, { roughness: 0.38, metalness: 0.45 });
    group.add(
      box(1.12, 0.62, 2.55, red, 0, 0.62, -0.05),
      box(1.02, 0.58, 0.8, red, 0, 1.22, 0.72),
      box(0.98, 0.44, 0.06, glass, 0, 1.2, 1.14),
      box(0.94, 0.38, 0.06, glass, 0, 1.2, 0.3),
      box(1.16, 0.13, 2.4, white, 0, 0.94, -0.05),
      box(0.32, 0.24, 1.5, silver, 0, 1.53, -0.2),
      box(0.56, 0.2, 0.55, dark, 0, 1.16, -1.08),
      wheel(tire, -0.59, 0.28, 0.77),
      wheel(tire, 0.59, 0.28, 0.77),
      wheel(tire, -0.59, 0.28, -0.78),
      wheel(tire, 0.59, 0.28, -0.78),
      wheel(tire, -0.59, 0.28, -1.25, 0.24),
      wheel(tire, 0.59, 0.28, -1.25, 0.24),
    );
    redLight = lamp(0xf0442e, 0xd51f15);
    blueLight = lamp(0x3877ff, 0x1d4fd3);
    group.add(box(0.34, 0.1, 0.13, redLight, -0.22, 1.56, 0.78), box(0.34, 0.1, 0.13, blueLight, 0.22, 1.56, 0.78));
    group.add(box(0.12, 0.08, 0.08, silver, 0, 1.8, -0.65));
  } else if (kind === 'dozer') {
    const yellow = mat(0xc9931e, { roughness: 0.7 });
    const black = mat(0x252521, { roughness: 0.95 });
    const steel = mat(0x717874, { roughness: 0.45, metalness: 0.6 });
    group.add(
      box(0.42, 0.46, 1.85, black, -0.56, 0.35, -0.02),
      box(0.42, 0.46, 1.85, black, 0.56, 0.35, -0.02),
      box(1.08, 0.62, 1.48, yellow, 0, 0.78, -0.08),
      box(0.78, 0.66, 0.64, yellow, 0, 1.34, -0.18),
      box(0.66, 0.34, 0.05, glass, 0, 1.4, 0.16),
      box(1.95, 0.2, 0.16, steel, 0, 0.62, 1.12),
      box(1.95, 0.5, 0.18, yellow, 0, 0.88, 1.22),
      box(0.15, 0.15, 0.7, dark, 0.68, 1.1, -0.8),
      wheel(tire, -0.56, 0.26, 0.62, 0.25),
      wheel(tire, 0.56, 0.26, 0.62, 0.25),
      wheel(tire, -0.56, 0.26, -0.7, 0.25),
      wheel(tire, 0.56, 0.26, -0.7, 0.25),
    );
  } else if (kind === 'helicopter') {
    const red = mat(0xa6312c, { roughness: 0.5 });
    const white = mat(0xe4ddcc, { roughness: 0.55 });
    const darkGlass = mat(0x1b3844, { roughness: 0.18, metalness: 0.65 });
    group.add(
      box(0.88, 0.62, 1.75, red, 0, 0.72, 0.1),
      box(0.82, 0.44, 0.6, white, 0, 0.72, 1.06),
      box(0.7, 0.34, 0.14, darkGlass, 0, 0.87, 1.3),
      box(0.15, 0.15, 1.7, red, 0, 0.85, -1.35),
      box(0.06, 0.55, 0.5, red, 0, 1.1, -2.08),
      box(0.12, 0.1, 0.65, white, 0, 0.28, 0.15),
      box(0.1, 0.1, 1.45, dark, -0.55, 0.15, 0.05),
      box(0.1, 0.1, 1.45, dark, 0.55, 0.15, 0.05),
      box(0.08, 0.26, 0.5, dark, -0.66, 1.18, -0.8),
      box(0.08, 0.26, 0.5, dark, 0.66, 1.18, -0.8),
    );
    rotor = new Group();
    rotor.position.set(0, 1.15, 0);
    const rotorBlade = box(3.3, 0.05, 0.11, dark, 0, 0, 0);
    const rotorBlade2 = box(0.11, 0.05, 3.0, dark, 0, 0, 0);
    rotor.add(rotorBlade, rotorBlade2);
    group.add(rotor);
    tailRotor = new Group();
    tailRotor.position.set(0.18, 1.1, -2.08);
    tailRotor.add(box(0.05, 0.75, 0.1, dark, 0, 0, 0), box(0.05, 0.1, 0.75, dark, 0, 0, 0));
    group.add(tailRotor);
  } else {
    const red = mat(0xad3a30, { roughness: 0.48 });
    const white = mat(0xe9e2d0, { roughness: 0.55 });
    const darkGlass = mat(0x1c3039, { roughness: 0.2, metalness: 0.5 });
    group.add(
      box(0.72, 0.62, 2.75, white, 0, 0.7, 0),
      box(0.7, 0.42, 0.6, red, 0, 0.7, 1.5),
      box(0.56, 0.26, 0.16, darkGlass, 0, 0.82, 1.72),
      box(3.15, 0.08, 0.82, red, 0, 0.84, 0.18),
      box(3.05, 0.05, 0.18, white, 0, 0.87, 0.18),
      box(0.14, 0.74, 0.75, red, 0, 1.15, -1.24),
      box(1.25, 0.06, 0.5, red, 0, 0.93, -1.14),
      box(0.34, 0.28, 0.7, white, -0.95, 0.6, 0.2),
      box(0.34, 0.28, 0.7, white, 0.95, 0.6, 0.2),
      box(0.12, 0.2, 0.36, darkGlass, -1.3, 0.66, 0.92),
      box(0.1, 0.1, 0.7, dark, 0, 0.16, 0.5),
      box(0.1, 0.1, 0.7, dark, 0, 0.16, -0.5),
    );
    const leftProp = new Group();
    leftProp.position.set(-0.95, 0.76, 0.46);
    const rightProp = new Group();
    rightProp.position.set(0.95, 0.76, 0.46);
    const bladeA = box(0.08, 0.06, 0.84, dark, 0, 0, 0);
    const bladeB = box(0.08, 0.06, 0.84, dark, 0, 0, 0);
    leftProp.add(bladeA);
    rightProp.add(bladeB);
    group.add(leftProp, rightProp);
  }

  return { group, rotor, tailRotor, redLight, blueLight };
}

export function createUnitShadow(): Mesh {
  const shadow = new Mesh(
    new SphereGeometry(0.55, 8, 5),
    new MeshStandardMaterial({ color: 0x0b0f0b, transparent: true, opacity: 0.16, depthWrite: false }),
  );
  shadow.scale.set(1.4, 0.06, 1.4);
  shadow.position.y = 0.05;
  return shadow;
}
