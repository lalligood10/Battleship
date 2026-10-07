/** Phase 5 achievements: `processGameEnd` against the Firestore emulator (the trigger itself doesn't run here). */
import { Timestamp } from 'firebase-admin/firestore';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ShipType } from '../src/game/config';
import type { Shot } from '../src/game/engine';
import { RETENTION_PATHS, type AchievementDoc } from '../src/game/analytics/contract';
import { db } from '../src/lib/firestore';
import { processGameEnd } from '../src/triggers/gameEnd';
import type { GameDoc } from '../src/types';
import { clearFirestore } from './setup';

const ALICE = 'uid-p5a-alice';
const BOB = 'uid-p5a-bob';
const ALL_SHIPS: ShipType[] = ['carrier', 'battleship', 'cruiser', 'submarine', 'destroyer'];
const shot = (row: number, col: number, result: Shot['result']): Shot => ({ row, col, result, at: 0 });

function finishedGame(overrides: Record<string, unknown> = {}): GameDoc {
  return {
    mode: 'classic',
    status: 'finished',
    playerUids: [ALICE, BOB],
    players: {
      [ALICE]: { username: 'Alice', sunkShips: ['destroyer'] },
      [BOB]: { username: 'Bob', sunkShips: ALL_SHIPS },
    },
    shots: { [ALICE]: [shot(0, 0, 'sunk')], [BOB]: [shot(1, 1, 'miss')] },
    winnerUid: ALICE,
    endReason: 'all_sunk',
    startedAt: Timestamp.fromMillis(1_000),
    finishedAt: Timestamp.fromMillis(61_000),
    ...overrides,
  } as unknown as GameDoc;
}

async function achievements(uid: string): Promise<AchievementDoc[]> {
  const snap = await db.collection(`users/${uid}/achievements`).get();
  return snap.docs.map((d) => d.data() as AchievementDoc).sort((a, b) => a.id.localeCompare(b.id));
}

beforeEach(async () => {
  await clearFirestore();
});

describe('achievements consumer via processGameEnd', () => {
  it('unlocks once, and stays once when processed twice and across two qualifying games', async () => {
    await processGameEnd('p5a-g1', finishedGame(), undefined, 5_000);
    await processGameEnd('p5a-g1', finishedGame(), undefined, 6_000);
    await processGameEnd('p5a-g2', finishedGame(), undefined, 7_000);

    const docs = await achievements(ALICE);
    expect(docs).toEqual([{ id: 'first-victory', unlockedAtMs: 5_000, gameId: 'p5a-g1', dailyDateKey: null }]);
    expect(await achievements(BOB)).toEqual([]);
    expect((await db.doc(RETENTION_PATHS.gameEndApplied('p5a-g2', 'achievements')).get()).exists).toBe(true);
  });

  it('a win over the hard bot gives admiral-slayer; the bot gets nothing', async () => {
    const bot = 'bot-admiral';
    const game = finishedGame({
      playerUids: [ALICE, bot],
      players: { [ALICE]: { username: 'Alice', sunkShips: [] }, [bot]: { username: 'Admiral Bot', sunkShips: ALL_SHIPS } },
      shots: { [ALICE]: [], [bot]: [] },
      isBotGame: true,
      botDifficulty: 'hard',
    });
    await processGameEnd('p5a-bot', game, undefined, 5_000);

    expect((await achievements(ALICE)).map((a) => a.id)).toEqual(['admiral-slayer', 'first-victory', 'flawless']);
    expect(await achievements(bot)).toEqual([]);
  });

  it('a resign win gives nothing', async () => {
    const game = finishedGame({
      endReason: 'resign',
      players: { [ALICE]: { username: 'Alice', sunkShips: [] }, [BOB]: { username: 'Bob', sunkShips: [] } },
    });
    await processGameEnd('p5a-resign', game, undefined, 5_000);

    expect(await achievements(ALICE)).toEqual([]);
    expect((await db.doc(RETENTION_PATHS.gameEndApplied('p5a-resign', 'achievements')).get()).exists).toBe(true);
  });

  it('a Salvo loser can still earn one-volley-sink', async () => {
    const placement = { type: 'destroyer' as const, row: 0, col: 0, horizontal: true };
    const game = finishedGame({
      mode: 'salvo',
      winnerUid: ALICE,
      shots: {
        [ALICE]: [shot(5, 5, 'miss')],
        [BOB]: [
          { ...shot(0, 0, 'hit'), volley: 1 },
          { ...shot(0, 1, 'sunk'), volley: 1, sunkShip: 'destroyer', sunkPlacement: placement },
        ],
      },
    });
    await processGameEnd('p5a-salvo', game, undefined, 5_000);

    expect((await achievements(BOB)).map((a) => a.id)).toEqual(['one-volley-sink']);
  });
});
