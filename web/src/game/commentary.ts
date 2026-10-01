import { SHIP_NAMES } from './placement';
import type { Game, Shot } from '../lib/types';

export interface CommentaryLine {
  id: string;
  text: string;
  at: number;
}

const PLAYER_HIT_REPLIES = [
  'Direct hit. You have my attention.',
  'That one found steel. Nicely aimed.',
  'A solid strike. I am adjusting course.',
];
const PLAYER_MISS_REPLIES = [
  'Wide of the mark. The sea keeps that one.',
  'A clean miss. My fleet sails on.',
  'Nothing but water. Try another bearing.',
];
const BOT_HIT_LINES = [
  'Target struck. Your damage control has work to do.',
  'That sounded expensive. Direct hit.',
  'Contact confirmed. I found your fleet.',
];
const BOT_MISS_LINES = [
  'Missed you. Recalculating.',
  'That shot found open water.',
  'No contact. I will correct the range.',
];

function lineFor(shot: Shot, shotIndex: number, firedByBot: boolean): string {
  if (shot.result === 'sunk') {
    const ship = SHIP_NAMES[shot.sunkShip ?? 'destroyer'];
    return firedByBot ? `Your ${ship} is going down.` : `You sank my ${ship}. Well played.`;
  }
  const lines = firedByBot
    ? shot.result === 'hit'
      ? BOT_HIT_LINES
      : BOT_MISS_LINES
    : shot.result === 'hit'
      ? PLAYER_HIT_REPLIES
      : PLAYER_MISS_REPLIES;
  return lines[shotIndex % lines.length]!;
}

export function commentaryForGame(game: Game, humanUid: string): CommentaryLine[] {
  if (!game.isBotGame) return [];
  const botUid = game.playerUids.find((uid) => uid !== humanUid);
  if (!botUid) return [];

  const humanShots = (game.shots[humanUid] ?? []).map((shot, index) => ({
    id: `${humanUid}-${index}`,
    text: lineFor(shot, index, false),
    at: shot.at,
  }));
  const botShots = (game.shots[botUid] ?? []).map((shot, index) => ({
    id: `${botUid}-${index}`,
    text: lineFor(shot, index, true),
    at: shot.at,
  }));
  return [...humanShots, ...botShots].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
}
