import { UnitKind } from './vehicleModels';

/** Road paving cost per tile. */
export const ROAD_COST_PER_TILE = 4;
/** Cost of one drip-torch backburn strip. */
export const TORCH_COST = 20;
/** Mutual-aid reinforcement prices. */
export const MUTUAL_AID_COST: Record<UnitKind, number> = {
  firetruck: 320,
  dozer: 240,
  helicopter: 420,
  tanker: 520,
};
/** Seconds from request until a mutual-aid unit reaches the station. */
export const MUTUAL_AID_ETA = 20;
/** Maximum mutual-aid units per shift. */
export const MUTUAL_AID_LIMIT = 3;

/** The incident commander's spending money for one shift. */
export class Budget {
  funds: number;
  spent = 0;
  earned = 0;

  constructor(
    startingFunds: number,
    public income: number,
  ) {
    this.funds = startingFunds;
  }

  update(dt: number): void {
    this.funds += this.income * dt;
  }

  canAfford(amount: number): boolean {
    return this.funds + 1e-6 >= amount;
  }

  spend(amount: number): boolean {
    if (!this.canAfford(amount)) return false;
    this.funds -= amount;
    this.spent += amount;
    return true;
  }

  earn(amount: number): void {
    this.funds += amount;
    this.earned += amount;
  }
}
