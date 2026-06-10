import { VehicleType } from './types';

export function mapMenubarToVehicleType(menubarType?: string): VehicleType | undefined {
  switch (menubarType) {
    case 'firetruck': return VehicleType.FIRETRUCK;
    case 'bulldozer': return VehicleType.BULLDOZER;
    case 'helicopter': return VehicleType.HELICOPTER;
    case 'airplane': return VehicleType.AIRPLANE;
    case 'firefighter': return VehicleType.FIREFIGHTER;
    case 'generic': return VehicleType.CAR;
    default: return VehicleType.CAR;
  }
}
