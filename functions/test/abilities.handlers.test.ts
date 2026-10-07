import { HttpsError } from 'firebase-functions/v2/https';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ShipPlacement } from '../src/game/engine';
import { createBotGame } from '../src/handlers/bots';
import {
  createGame,
  fireShot,
  joinGame,
  placeShips,
  useAbility,
} from '../src/handlers/games';
import { setUsername } from '../src/handlers/users';
import { refs } from '../src/lib/firestore';
import { clearFirestore } from './setup';

const ALICE = 'uid-ability-alice';
const BOB = 'uid-ability-bob';
const BOT = 'bot-cadet';

const FLEET: ShipPlacement[] = [
  { type: 'carrier', row: 0, col: 0, horizontal: true },
  { type: 'battleship', row: 2, col: 0, horizontal: true },
  { type: 'cruiser', row: 4, col: 0, horizontal: true },
  { type: 'submarine', row: 6, col: 0, horizontal: true },
  { type: 'destroyer', row: 8, col: 0, horizontal: true },
];

async function expectHttpsError(promise: Promise<unknown>, code: string, messagePart?: string) {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(HttpsError);
  const error = caught as HttpsError;
  expect(error.code).toBe(code);
  if (messagePart) expect(error.message).toContain(messagePart);
}

async function setupPlayers() {
  await setUsername(ALICE, { username: 'AbilityAlice' });
  await setUsername(BOB, { username: 'AbilityBob' });
}

async function activeAbilitiesGame(): Promise<string> {
  await setupPlayers();
  const { gameId, code } = await createGame(ALICE, { mode: 'abilities' });
  await joinGame(BOB, { code });
  await placeShips(ALICE, { gameId, ships: FLEET });
  await placeShips(BOB, { gameId, ships: FLEET });
  return gameId;
}

beforeEach(async () => {
  await clearFirestore();
});

describe('Abilities game callables', () => {
  it('validates supported ids and target shapes before opening a transaction', async () => {
    await expectHttpsError(
      useAbility(ALICE, {
        gameId: 'game-not-needed-for-validation',
        abilityId: 'not-an-ability',
        target: { row: 1, col: 2 },
      }),
      'invalid-argument',
      'Ability must be',
    );
    await expectHttpsError(
      useAbility(ALICE, {
        gameId: 'game-not-needed-for-validation',
        abilityId: 'carrier-airstrike',
        target: { row: 1.5, col: 2, horizontal: true },
      }),
      'invalid-argument',
      'integer row and col',
    );
    await expectHttpsError(
      useAbility(ALICE, {
        gameId: 'game-not-needed-for-validation',
        abilityId: 'destroyer-relocate',
        target: { row: 1, col: 2, horizontal: 1 },
      }),
      'invalid-argument',
      'horizontal boolean',
    );
  });

  it('resolves airstrike cells, private hit cells, ability log, and player stats', async () => {
    const gameId = await activeAbilitiesGame();
    const game = (await refs.game(gameId).get()).data()!;
    const actor = game.currentTurnUid!;
    const opponent = game.playerUids.find((uid) => uid !== actor)!;

    await useAbility(actor, {
      gameId,
      abilityId: 'carrier-airstrike',
      target: { row: 8, col: 0, horizontal: true },
    });

    const updated = (await refs.game(gameId).get()).data()!;
    expect(updated.shots[actor]).toHaveLength(3);
    expect(updated.players[actor]).toMatchObject({ shotsFired: 3, hits: 2 });
    expect(updated.players[opponent]?.sunkShips).toContain('destroyer');
    expect(updated.abilityLog).toHaveLength(1);
    expect(updated.abilityLog![0]).toMatchObject({
      player: actor,
      result: {
        abilityId: 'carrier-airstrike',
        cells: [
          { row: 8, col: 0, result: 'hit' },
          { row: 8, col: 2, result: 'miss' },
          { row: 8, col: 1, result: 'sunk' },
        ],
      },
    });
    expect((await refs.privateBoard(gameId, opponent).get()).data()!.hitCells).toHaveLength(2);
  });

  it('records a positive sonar result without adding shots', async () => {
    const gameId = await activeAbilitiesGame();
    const game = (await refs.game(gameId).get()).data()!;
    const actor = game.currentTurnUid!;
    const shotCount = game.shots[actor]?.length ?? 0;
    const center = { row: 0, col: 0 };

    await useAbility(actor, { gameId, abilityId: 'submarine-sonar', target: center });

    const updated = (await refs.game(gameId).get()).data()!;
    expect(updated.shots[actor]).toHaveLength(shotCount);
    expect(updated.abilityLog?.[0]).toMatchObject({
      player: actor,
      result: { abilityId: 'submarine-sonar', center, shipPresent: true },
    });
  });

  it('records a negative sonar result without adding shots', async () => {
    const gameId = await activeAbilitiesGame();
    const game = (await refs.game(gameId).get()).data()!;
    const actor = game.currentTurnUid!;
    const shotCount = game.shots[actor]?.length ?? 0;
    const center = { row: 9, col: 9 };

    await useAbility(actor, { gameId, abilityId: 'submarine-sonar', target: center });

    const updated = (await refs.game(gameId).get()).data()!;
    expect(updated.shots[actor]).toHaveLength(shotCount);
    expect(updated.abilityLog?.[0]).toMatchObject({
      player: actor,
      result: { abilityId: 'submarine-sonar', center, shipPresent: false },
    });
  });

  it('relocates only the private destroyer fleet and does not expose its new position', async () => {
    const gameId = await activeAbilitiesGame();
    const game = (await refs.game(gameId).get()).data()!;
    const actor = game.currentTurnUid!;
    const target = { row: 8, col: 4, horizontal: true };

    await useAbility(actor, { gameId, abilityId: 'destroyer-relocate', target });

    const updated = (await refs.game(gameId).get()).data()!;
    const publicLog = updated.abilityLog?.[0];
    expect(publicLog).toEqual({
      player: actor,
      turnNumber: game.turnNumber,
      result: { abilityId: 'destroyer-relocate' },
    });
    expect(JSON.stringify(updated)).not.toContain('"row":8,"col":4');
    const privateBoard = (await refs.privateBoard(gameId, actor).get()).data()!;
    expect(privateBoard.fleet.find((ship) => ship.type === 'destroyer')).toEqual({
      type: 'destroyer',
      ...target,
    });
  });

  it('rejects a second use of an already spent ability', async () => {
    const gameId = await activeAbilitiesGame();
    const game = (await refs.game(gameId).get()).data()!;
    const actor = game.currentTurnUid!;
    await useAbility(actor, {
      gameId,
      abilityId: 'submarine-sonar',
      target: { row: 0, col: 0 },
    });
    const nextTurn = (await refs.game(gameId).get()).data()!.currentTurnUid!;
    await fireShot(nextTurn, { gameId, row: 9, col: 9 });
    await expectHttpsError(
      useAbility(actor, {
        gameId,
        abilityId: 'submarine-sonar',
        target: { row: 0, col: 0 },
      }),
      'failed-precondition',
      'already been used',
    );
  });

  it('accepts a normal fireShot in Abilities mode', async () => {
    const gameId = await activeAbilitiesGame();
    const game = (await refs.game(gameId).get()).data()!;

    await fireShot(game.currentTurnUid!, { gameId, row: 9, col: 9 });

    const updated = (await refs.game(gameId).get()).data()!;
    expect(updated.shots[game.currentTurnUid!]).toHaveLength(1);
  });

  it('replies to an Abilities-mode human shot from a bot in the same transaction', async () => {
    await setUsername(ALICE, { username: 'AbilityAlice' });
    const { gameId } = await createBotGame(ALICE, { difficulty: 'easy', mode: 'abilities' });
    await placeShips(ALICE, { gameId, ships: FLEET });

    await fireShot(ALICE, { gameId, row: 9, col: 9 });

    const game = (await refs.game(gameId).get()).data()!;
    expect(game.shots[ALICE]).toHaveLength(1);
    expect(game.shots[BOT]).toHaveLength(1);
    expect(game.currentTurnUid).toBe(ALICE);
  });
});
