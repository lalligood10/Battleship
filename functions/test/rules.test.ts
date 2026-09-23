/**
 * Firestore security-rule tests. These prove the anti-cheat guarantee: a player can read their
 * own hidden board but never the opponent's, and clients cannot write game state directly.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, query, setDoc, updateDoc, where, deleteDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { FIRESTORE_HOST, PROJECT_ID } from './setup';

const ALICE = 'uid-alice';
const BOB = 'uid-bob';
const EVE = 'uid-eve';
const GAME = 'game-1';

let env: RulesTestEnvironment;

beforeAll(async () => {
  const [host, port] = FIRESTORE_HOST!.split(':');
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      host,
      port: Number(port),
      rules: readFileSync(resolve(__dirname, '../../firestore.rules'), 'utf8'),
    },
  });
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  // Seed with the Admin-equivalent (rules bypassed).
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'users', ALICE), { username: 'Alice', rating: 1000 });
    await setDoc(doc(db, 'users', BOB), { username: 'Bob', rating: 1000 });
    await setDoc(doc(db, 'users', ALICE, 'opponents', BOB), { username: 'Bob', gamesPlayed: 1 });
    await setDoc(doc(db, 'usernames', 'alice'), { uid: ALICE });
    await setDoc(doc(db, 'games', GAME), {
      code: 'ABC234',
      status: 'active',
      hostUid: ALICE,
      playerUids: [ALICE, BOB],
      currentTurnUid: ALICE,
      updatedAt: new Date(),
    });
    await setDoc(doc(db, 'games', GAME, 'private', ALICE), { fleet: [{ type: 'carrier' }], hitCells: [] });
    await setDoc(doc(db, 'games', GAME, 'private', BOB), { fleet: [{ type: 'carrier' }], hitCells: [] });
    await setDoc(doc(db, 'gameCodes', 'ABC234'), { gameId: GAME });
    await setDoc(doc(db, 'weeklyWins', '2026-W39', 'players', ALICE), { username: 'Alice', wins: 1 });
    await setDoc(doc(db, 'quickMatch', ALICE), { username: 'Alice', gameId: null });
  });
});

const as = (uid: string) => env.authenticatedContext(uid).firestore();
const anon = () => env.unauthenticatedContext().firestore();

describe('hidden boards (anti-cheat)', () => {
  it('a player can read their own private board', async () => {
    await assertSucceeds(getDoc(doc(as(ALICE), 'games', GAME, 'private', ALICE)));
  });

  it('a player can NOT read the opponent private board', async () => {
    await assertFails(getDoc(doc(as(ALICE), 'games', GAME, 'private', BOB)));
    await assertFails(getDoc(doc(as(BOB), 'games', GAME, 'private', ALICE)));
  });

  it('nobody can write a private board from a client', async () => {
    await assertFails(updateDoc(doc(as(ALICE), 'games', GAME, 'private', ALICE), { hitCells: [] }));
    await assertFails(setDoc(doc(as(BOB), 'games', GAME, 'private', BOB), { fleet: [] }));
  });

  it('listing the private subcollection is refused', async () => {
    await assertFails(getDocs(collection(as(ALICE), 'games', GAME, 'private')));
  });
});

describe('games', () => {
  it('players can read their game; outsiders and anonymous users cannot', async () => {
    await assertSucceeds(getDoc(doc(as(ALICE), 'games', GAME)));
    await assertSucceeds(getDoc(doc(as(BOB), 'games', GAME)));
    await assertFails(getDoc(doc(as(EVE), 'games', GAME)));
    await assertFails(getDoc(doc(anon(), 'games', GAME)));
  });

  it('players can list only their own games', async () => {
    await assertSucceeds(getDocs(query(collection(as(ALICE), 'games'), where('playerUids', 'array-contains', ALICE))));
    await assertFails(getDocs(query(collection(as(EVE), 'games'), where('playerUids', 'array-contains', ALICE))));
    await assertFails(getDocs(collection(as(ALICE), 'games')));
  });

  it('clients cannot modify game state (turns, status, shots)', async () => {
    await assertFails(updateDoc(doc(as(ALICE), 'games', GAME), { currentTurnUid: BOB }));
    await assertFails(updateDoc(doc(as(ALICE), 'games', GAME), { status: 'finished', winnerUid: ALICE }));
    await assertFails(setDoc(doc(as(ALICE), 'games', 'new-game'), { playerUids: [ALICE] }));
  });

  it('join codes cannot be enumerated from a client', async () => {
    await assertFails(getDoc(doc(as(ALICE), 'gameCodes', 'ABC234')));
    await assertFails(getDocs(collection(as(ALICE), 'gameCodes')));
  });
});

describe('users and leaderboards', () => {
  it('signed-in users can read profiles and leaderboards; anonymous cannot', async () => {
    await assertSucceeds(getDoc(doc(as(BOB), 'users', ALICE)));
    await assertSucceeds(getDocs(collection(as(BOB), 'users')));
    await assertSucceeds(getDocs(collection(as(BOB), 'weeklyWins', '2026-W39', 'players')));
    await assertFails(getDoc(doc(anon(), 'users', ALICE)));
    await assertFails(getDocs(collection(anon(), 'users')));
  });

  it('profiles, stats and ratings cannot be edited by clients', async () => {
    await assertFails(updateDoc(doc(as(ALICE), 'users', ALICE), { rating: 9999 }));
    await assertFails(setDoc(doc(as(ALICE), 'weeklyWins', '2026-W39', 'players', ALICE), { wins: 99 }));
    await assertFails(setDoc(doc(as(ALICE), 'usernames', 'bob'), { uid: ALICE }));
  });

  it('opponents list is private to its owner', async () => {
    await assertSucceeds(getDocs(collection(as(ALICE), 'users', ALICE, 'opponents')));
    await assertFails(getDocs(collection(as(BOB), 'users', ALICE, 'opponents')));
  });

  it('users manage only their own push tokens with a constrained shape', async () => {
    await assertSucceeds(setDoc(doc(as(ALICE), 'users', ALICE, 'private', 'push'), { tokens: ['t1'], updatedAt: new Date() }));
    await assertFails(setDoc(doc(as(BOB), 'users', ALICE, 'private', 'push'), { tokens: ['evil'], updatedAt: new Date() }));
    await assertFails(setDoc(doc(as(ALICE), 'users', ALICE, 'private', 'push'), { tokens: 'not-a-list', updatedAt: new Date() }));
    await assertFails(setDoc(doc(as(ALICE), 'users', ALICE, 'private', 'push'), { tokens: [], rating: 5000 }));
    await assertFails(getDoc(doc(as(BOB), 'users', ALICE, 'private', 'push')));
  });
});

describe('quick match', () => {
  it('a user can watch and delete only their own ticket', async () => {
    await assertSucceeds(getDoc(doc(as(ALICE), 'quickMatch', ALICE)));
    await assertFails(getDoc(doc(as(BOB), 'quickMatch', ALICE)));
    await assertFails(setDoc(doc(as(BOB), 'quickMatch', BOB), { username: 'Bob' }));
    await assertFails(getDocs(collection(as(BOB), 'quickMatch')));
    await assertSucceeds(deleteDoc(doc(as(ALICE), 'quickMatch', ALICE)));
  });
});
