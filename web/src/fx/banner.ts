import type { Side } from '../feel/cues';
import { SHIP_NAMES, type ShipType } from '../game/placement';

export function sinkBannerText(side: Side, shipId: ShipType): string {
  const name = SHIP_NAMES[shipId];
  return side === 'target' ? `You sank their ${name}` : `They sank your ${name}`;
}
