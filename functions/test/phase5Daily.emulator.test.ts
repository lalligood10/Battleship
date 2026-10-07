/** Phase 5 daily challenge callables against the Firestore emulator. */
import { HttpsError } from 'firebase-functions/v2/https';
import { beforeEach, describe, expect, it } from 'vitest';
import { cellsOf } from '../src/game/engine';
import { RETENTION_PATHS, dailyDateKey, type DailyChallengePrivateDoc, type DailyView } from '../src/game/analytics/contract';
import { ensureDailyChallenge, fireDailyShot, getDailyChallenge } from '../src/handlers/daily';
import { db } from '../src/lib/firestore';
import { clearFirestore } from './setup';

const ALICE = 'uid-p5d-alice';
const BOB = 'uid-p5d-bob';
const GUEST = 'uid-p5d-guest';
const DAY1 = Date.UTC(2026, 9, 7, 12);
const DAY2 = Date.UTC(2026, 9, 8, 9);
const KEY1 = dailyDateKey(DAY1);
const KEY2 = dailyDateKey(DAY2);

async function privateDoc(dateKey: string): Promise<DailyChallengePrivateDoc> {
  return (await db.doc(RETENTION_PATHS.dailyChallengePrivate(dateKey)).get()).data() as DailyChallengePrivateDoc;
}

async function expectError(promise: Promise<unknown>, code: string) {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(HttpsError);
  expect((err as HttpsError).code).toBe(code);
}

/** Fires at every fleet cell, plus one known miss first. Returns the final view. */
async function clearRun(uid: string, dateKey: string, nowMs: number): Promise<DailyView> {
  const { fleet } = await privateDoc(dateKey);
  const occupied = new Set(fleet.flatMap((s) => cellsOf(s).map((c) => `${c.row},${c.col}`)));
  const miss = [...Array(100).keys()].map((i) => ({ row: Math.floor(i / 10), col: i % 10 })).find((c) => !occupied.has(`${c.row},${c.col}`))!;
  let view = await fireDailyShot(uid, { dateKey, ...miss }, nowMs);
  for (const ship of fleet) {
    for (const c of cellsOf(ship)) view = await fireDailyShot(uid, { dateKey, ...c }, nowMs + 1);
  }
  return view;
}

beforeEach(async () => {
  await clearFirestore();
  await db.doc(`users/${ALICE}`).set({ username: 'DailyAlice' });
  await db.doc(`users/${BOB}`).set({ username: 'DailyBob' });
  await db.doc(`users/${GUEST}`).set({ username: 'Guest-1234', isGuest: true });
});

describe('getDailyChallenge', () => {
  it('returns an empty run with the public definition, and never the fleet or seed', async () => {
    const view = await getDailyChallenge(ALICE, {}, DAY1);
    expect(view).toEqual({
      dateKey: KEY1,
      shipTypes: ['carrier', 'battleship', 'cruiser', 'submarine', 'destroyer'],
      shots: [],
      sunkShips: [],
      completedAtMs: null,
    });
    expect(JSON.stringify(view)).not.toMatch(/fleet|seed|horizontal/);
    const pub = (await db.doc(RETENTION_PATHS.dailyChallenge(KEY1)).get()).data();
    expect(Object.keys(pub!).sort()).toEqual(['createdAtMs', 'dateKey', 'shipTypes']);
    expect((await privateDoc(KEY1)).fleet).toHaveLength(5);
  });

  it('concurrent first calls create a single seed', async () => {
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => ensureDailyChallenge(KEY1, DAY1 + i)));
    expect(new Set(results.map((r) => r.createdAtMs)).size).toBe(1);
    const seed = (await privateDoc(KEY1)).seed;
    await getDailyChallenge(BOB, {}, DAY1);
    expect((await privateDoc(KEY1)).seed).toBe(seed);
    expect(Number.isInteger(seed) && seed >= 0 && seed < 2 ** 31).toBe(true);
  });

  it('a resumed run comes back on the next call', async () => {
    await fireDailyShot(ALICE, { dateKey: KEY1, row: 3, col: 4 }, DAY1);
    const view = await getDailyChallenge(ALICE, {}, DAY1 + 1_000);
    expect(view.shots.map((s) => [s.row, s.col])).toEqual([[3, 4]]);
  });
});

describe('fireDailyShot', () => {
  it('two users get identical results on the same cells, and responses never carry the fleet', async () => {
    await getDailyChallenge(ALICE, {}, DAY1);
    const cells = [
      { row: 0, col: 0 },
      { row: 4, col: 4 },
      { row: 9, col: 9 },
      { row: 2, col: 7 },
      { row: 6, col: 1 },
    ];
    const views: DailyView[][] = [[], []];
    for (const c of cells) {
      views[0]!.push(await fireDailyShot(ALICE, { dateKey: KEY1, ...c }, DAY1));
      views[1]!.push(await fireDailyShot(BOB, { dateKey: KEY1, ...c }, DAY1));
    }
    const results = (v: DailyView) => v.shots.map((s) => [s.row, s.col, s.result, s.sunkShip ?? null]);
    expect(results(views[0]!.at(-1)!)).toEqual(results(views[1]!.at(-1)!));
    for (const v of views.flat()) {
      expect(Object.keys(v).sort()).toEqual(['completedAtMs', 'dateKey', 'shipTypes', 'shots', 'sunkShips']);
      expect(JSON.stringify(v)).not.toMatch(/fleet|seed/);
    }
  });

  it('rejects repeated cells, stale or malformed dateKeys and off-board targets', async () => {
    await fireDailyShot(ALICE, { dateKey: KEY1, row: 1, col: 1 }, DAY1);
    await expectError(fireDailyShot(ALICE, { dateKey: KEY1, row: 1, col: 1 }, DAY1), 'failed-precondition');
    await expectError(fireDailyShot(ALICE, { dateKey: KEY1, row: 2, col: 2 }, DAY2), 'failed-precondition');
    await expectError(fireDailyShot(ALICE, { dateKey: '2020-01-01', row: 2, col: 2 }, DAY1), 'failed-precondition');
    await expectError(fireDailyShot(ALICE, { dateKey: KEY1, row: 10, col: 0 }, DAY1), 'invalid-argument');
    await expectError(fireDailyShot(ALICE, { dateKey: KEY1, row: -1, col: 0 }, DAY1), 'invalid-argument');
    await expectError(fireDailyShot(ALICE, { dateKey: KEY1, row: 1.5, col: 0 }, DAY1), 'invalid-argument');
    await expectError(fireDailyShot(ALICE, { row: 0, col: 0 }, DAY1), 'invalid-argument');
  });

  it('a sink carries sunkShip and sunkPlacement, like normal games', async () => {
    await getDailyChallenge(ALICE, {}, DAY1);
    const destroyer = (await privateDoc(KEY1)).fleet.find((s) => s.type === 'destroyer')!;
    let view: DailyView | undefined;
    for (const c of cellsOf(destroyer)) view = await fireDailyShot(ALICE, { dateKey: KEY1, ...c }, DAY1);
    const last = view!.shots.at(-1)!;
    expect(last).toMatchObject({ result: 'sunk', sunkShip: 'destroyer', sunkPlacement: destroyer });
    expect(view!.sunkShips).toEqual(['destroyer']);
    expect(view!.shots[0]!.result).toBe('hit');
  });

  it('completion writes the score and daily-clear exactly once, also across a second day', async () => {
    await getDailyChallenge(ALICE, {}, DAY1);
    const view = await clearRun(ALICE, KEY1, DAY1);
    expect(view.completedAtMs).toBe(DAY1 + 1);
    expect(view.sunkShips).toHaveLength(5);
    expect(view.shots).toHaveLength(18);
    await expectError(fireDailyShot(ALICE, { dateKey: KEY1, row: 9, col: 9 }, DAY1 + 2), 'failed-precondition');

    const score = (await db.doc(RETENTION_PATHS.dailyScore(KEY1, ALICE)).get()).data();
    expect(score).toEqual({ username: 'DailyAlice', shots: 18, completedAtMs: DAY1 + 1 });
    const clear = async () => (await db.doc(RETENTION_PATHS.achievement(ALICE, 'daily-clear')).get()).data();
    expect(await clear()).toEqual({ id: 'daily-clear', unlockedAtMs: DAY1 + 1, gameId: null, dailyDateKey: KEY1 });

    await getDailyChallenge(ALICE, {}, DAY2);
    await clearRun(ALICE, KEY2, DAY2);
    expect((await db.doc(RETENTION_PATHS.dailyScore(KEY2, ALICE)).get()).exists).toBe(true);
    expect(await clear()).toEqual({ id: 'daily-clear', unlockedAtMs: DAY1 + 1, gameId: null, dailyDateKey: KEY1 });
    expect((await db.collection(`users/${ALICE}/achievements`).get()).size).toBe(1);
    expect((await db.collection(`dailyScores/${KEY1}/players`).get()).size).toBe(1);
  });

  it("a guest's completion writes no score but still unlocks daily-clear", async () => {
    await getDailyChallenge(GUEST, {}, DAY1);
    const view = await clearRun(GUEST, KEY1, DAY1);
    expect(view.completedAtMs).not.toBeNull();
    expect((await db.doc(RETENTION_PATHS.dailyScore(KEY1, GUEST)).get()).exists).toBe(false);
    expect((await db.doc(RETENTION_PATHS.achievement(GUEST, 'daily-clear')).get()).exists).toBe(true);
  });

  it('a signed-in user without a profile can play but is not scored', async () => {
    await getDailyChallenge('uid-p5d-anon', {}, DAY1);
    await clearRun('uid-p5d-anon', KEY1, DAY1);
    expect((await db.collection(`dailyScores/${KEY1}/players`).get()).size).toBe(0);
  });
});
