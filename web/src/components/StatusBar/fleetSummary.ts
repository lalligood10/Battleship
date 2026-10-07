import { SHIP_LENGTHS, SHIP_NAMES, SHIP_TYPES, type ShipType } from '../../game/placement';

export function fleetSummary(sunk: readonly ShipType[]): {
  afloat: number;
  total: number;
  ships: Array<{ type: ShipType; name: string; length: number; sunk: boolean }>;
} {
  const sunkShips = new Set(sunk);
  const ships = SHIP_TYPES.map((type) => ({
    type,
    name: SHIP_NAMES[type],
    length: SHIP_LENGTHS[type],
    sunk: sunkShips.has(type),
  }));
  return {
    afloat: ships.filter((ship) => !ship.sunk).length,
    total: ships.length,
    ships,
  };
}
