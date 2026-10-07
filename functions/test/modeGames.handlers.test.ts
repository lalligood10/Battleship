import { HttpsError } from 'firebase-functions/v2/https';
import { beforeEach, describe, expect, it } from 'vitest';
import { chooseShot } from '../src/game/ai';
import { deriveRng } from '../src/game/core/rng';
import { cellKey, cellsOf, type Coordinate, type ShipPlacement, type Shot } from '../src/game/engine';
import { createBotGame } from '../src/handlers/bots';
import {
  createGame,
  fireSalvo,
  fireShot,
  joinGame,
  placeShips,
  useAbility,
} from '../src/handlers/games';
import { setUsername } from '../src/handlers/users';
import { refs } from '../src/lib/firestore';
import { clearFirestore } from './setup';

const ALICE = 'uid-mode-alice';
const BOB = 'uid-mode-bob';
const BOT = 'bot-cadet';
const BOARD_SIZE = 10;

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

function seedAvoidingFleet(extraFleet: ShipPlacement[] = []): number {
  const occupied = new Set([...FLEET, ...extraFleet].flatMap((ship) =>
    cellsOf(ship).map((cell) => cellKey(cell.row, cell.col)),
  ));
  for (let seed = 1; seed <= 10_000; seed++) {
    const shots: Shot[] = [];
    const exclude = new Set<string>();
    let safe = true;
    for (let index = 0; index < 8; index++) {
      const target = chooseShot({
        shots,
        boardSize: BOARD_SIZE,
        difficulty: 'easy',
        rng: deriveRng(seed, 'shot', index),
        exclude,
      });
      const key = cellKey(target.row, target.col);
      if (occupied.has(key)) {
        safe = false;
        break;
      }
      shots.push({ ...target, result: 'miss', at: index });
      exclude.add(key);
    }
    if (safe) return seed;
  }
  throw new Error('Could not choose a deterministic bot seed');
}

async function botGame(mode: 'classic' | 'salvo' | 'abilities') {
  await setUsername(ALICE, { username: 'ModeAlice' });
  const { gameId } = await createBotGame(ALICE, { difficulty: 'easy', mode });
  const movedDestroyer = { type: 'destroyer', row: 9, col: 8, horizontal: true } as ShipPlacement;
  await refs.privateBoard(gameId, BOT).update({
    rngSeed: seedAvoidingFleet(mode === 'abilities' ? [movedDestroyer] : []),
  });
  await placeShips(ALICE, { gameId, ships: FLEET });
  return gameId;
}

async function humanAbilitiesGame() {
  await setUsername(ALICE, { username: 'ModeAlice' });
  await setUsername(BOB, { username: 'ModeBob' });
  const { gameId, code } = await createGame(ALICE, { mode: 'abilities' });
  await joinGame(BOB, { code });
  await placeShips(ALICE, { gameId, ships: FLEET });
  await placeShips(BOB, { gameId, ships: FLEET });
  return gameId;
}

const allCells = (): Coordinate[] =>
  Array.from({ length: BOARD_SIZE ** 2 }, (_, index) => ({
    row: Math.floor(index / BOARD_SIZE),
    col: index % BOARD_SIZE,
  }));

function unusedCells(shots: Shot[]): Coordinate[] {
  const fired = new Set(shots.map((shot) => cellKey(shot.row, shot.col)));
  return allCells().filter((cell) => !fired.has(cellKey(cell.row, cell.col)));
}

beforeEach(async () => {
  await clearFirestore();
});

describe('mode game handler gates', () => {
  it('plays a complete Salvo bot game with exact volleys and a bot reply after each live volley', async () => {
    const gameId = await botGame('salvo');
    const botBoard = (await refs.privateBoard(gameId, BOT).get()).data()!;
    const preferred = botBoard.fleet.flatMap((ship) => cellsOf(ship));
    let game = (await refs.game(gameId).get()).data()!;
    let volleys = 0;

    while (game.status === 'active') {
      expect(game.currentTurnUid).toBe(ALICE);
      const shooterShots = game.shots[ALICE] ?? [];
      const beforeBotShots = game.shots[BOT]?.length ?? 0;
      const used = new Set(shooterShots.map((shot) => cellKey(shot.row, shot.col)));
      const targets = [...preferred, ...allCells()].filter((cell, index, cells) => {
        const key = cellKey(cell.row, cell.col);
        return !used.has(key) && cells.findIndex((candidate) => cellKey(candidate.row, candidate.col) === key) === index;
      });
      const allowance = Math.min(
        FLEET.length - game.players[ALICE]!.sunkShips.length,
        BOARD_SIZE ** 2 - used.size,
      );
      expect(allowance).toBeGreaterThan(0);
      expect(targets.length).toBeGreaterThanOrEqual(allowance);
      await fireSalvo(ALICE, { gameId, targets: targets.slice(0, allowance) });

      game = (await refs.game(gameId).get()).data()!;
      volleys++;
      expect(volleys).toBeLessThan(20);
      if (game.status === 'active') {
        const expectedBotCount = Math.min(
          FLEET.length - game.players[BOT]!.sunkShips.length,
          BOARD_SIZE ** 2 - beforeBotShots,
        );
        expect(game.shots[BOT]!.length - beforeBotShots).toBe(expectedBotCount);
        expect(expectedBotCount).toBeGreaterThan(0);
        expect(game.currentTurnUid).toBe(ALICE);
      }
    }

    expect(game.status).toBe('finished');
    expect(game.mode).toBe('salvo');
    expect(game.winnerUid).toBe(ALICE);
  });

  it('plays a complete Abilities bot game using all powers and normal shots with a bot reply each turn', async () => {
    const gameId = await botGame('abilities');
    const botBoard = (await refs.privateBoard(gameId, BOT).get()).data()!;
    const carrier = botBoard.fleet.find((ship) => ship.type === 'carrier')!;
    const movedDestroyer = { row: 9, col: 8, horizontal: true };
    let game = (await refs.game(gameId).get()).data()!;

    const useWithBotReply = async (action: () => Promise<unknown>) => {
      const beforeBotShots = (game.shots[BOT] ?? []).length;
      await action();
      game = (await refs.game(gameId).get()).data()!;
      if (game.status === 'active') {
        expect(game.shots[BOT]!.length - beforeBotShots).toBe(1);
        expect(game.currentTurnUid).toBe(ALICE);
      }
    };

    expect(game.currentTurnUid).toBe(ALICE);
    await useWithBotReply(() =>
      useAbility(ALICE, {
        gameId,
        abilityId: 'destroyer-relocate',
        target: movedDestroyer,
      }),
    );
    await useWithBotReply(() =>
      useAbility(ALICE, {
        gameId,
        abilityId: 'submarine-sonar',
        target: { row: 5, col: 5 },
      }),
    );
    const horizontal = carrier.horizontal;
    await useWithBotReply(() =>
      useAbility(ALICE, {
        gameId,
        abilityId: 'carrier-airstrike',
        target: { row: carrier.row, col: carrier.col, horizontal },
      }),
    );

    let normalShots = 0;
    while (game.status === 'active') {
      const botShotsBefore = (game.shots[BOT] ?? []).length;
      const botFired = game.shots[ALICE] ?? [];
      const already = new Set(botFired.map((shot) => cellKey(shot.row, shot.col)));
      const target =
        botBoard.fleet
          .flatMap((ship) => cellsOf(ship))
          .find((cell) => !already.has(cellKey(cell.row, cell.col))) ??
        unusedCells(botFired)[0]!;
      await fireShot(ALICE, { gameId, ...target });
      game = (await refs.game(gameId).get()).data()!;
      normalShots++;
      expect(normalShots).toBeLessThan(100);
      if (game.status === 'active') {
        expect(game.shots[BOT]!.length - botShotsBefore).toBe(1);
        expect(game.currentTurnUid).toBe(ALICE);
      }
    }

    expect(game.status).toBe('finished');
    expect(game.winnerUid).toBe(ALICE);
    expect(normalShots).toBeGreaterThan(0);
    expect(new Set(game.abilityLog!.map((entry) => entry.result.abilityId))).toEqual(
      new Set(['carrier-airstrike', 'submarine-sonar', 'destroyer-relocate']),
    );
  });

  it('rejects duplicate, off-board, already-fired, and wrong-mode Salvo actions', async () => {
    const salvoGameId = await botGame('salvo');
    const valid = allCells().slice(0, 5);
    await expectHttpsError(
      fireSalvo(ALICE, { gameId: salvoGameId, targets: [valid[0], valid[0], ...valid.slice(2)] }),
      'invalid-argument',
      'same cell twice',
    );
    await expectHttpsError(
      fireSalvo(ALICE, { gameId: salvoGameId, targets: [{ row: 10, col: 0 }, ...valid.slice(1)] }),
      'invalid-argument',
      'off the board',
    );

    await fireSalvo(ALICE, { gameId: salvoGameId, targets: valid });
    await expectHttpsError(
      fireSalvo(ALICE, { gameId: salvoGameId, targets: [valid[0], ...allCells().slice(5, 9)] }),
      'failed-precondition',
      'already fired',
    );
    await expectHttpsError(
      useAbility(ALICE, {
        gameId: salvoGameId,
        abilityId: 'submarine-sonar',
        target: { row: 5, col: 5 },
      }),
      'failed-precondition',
      'Salvo volley',
    );

    const classicGameId = await botGame('classic');
    await expectHttpsError(
      fireSalvo(ALICE, { gameId: classicGameId, targets: valid }),
      'failed-precondition',
      'Classic mode',
    );
  });

  it('rejects off-board airstrikes and destroyer relocations onto fired or damaged cells', async () => {
    const gameId = await humanAbilitiesGame();
    let game = (await refs.game(gameId).get()).data()!;
    let actor = game.currentTurnUid!;
    let opponent = game.playerUids.find((uid) => uid !== actor)!;
    await expectHttpsError(
      useAbility(actor, {
        gameId,
        abilityId: 'carrier-airstrike',
        target: { row: 9, col: 8, horizontal: true },
      }),
      'invalid-argument',
      'off the board',
    );

    await fireShot(actor, { gameId, row: 0, col: 9 });
    await fireShot(opponent, { gameId, row: 9, col: 8 });
    game = (await refs.game(gameId).get()).data()!;
    actor = game.currentTurnUid!;
    await expectHttpsError(
      useAbility(actor, {
        gameId,
        abilityId: 'destroyer-relocate',
        target: { row: 9, col: 8, horizontal: true },
      }),
      'invalid-argument',
      'legal placement',
    );

    const damagedGameId = await humanAbilitiesGame();
    game = (await refs.game(damagedGameId).get()).data()!;
    actor = game.currentTurnUid!;
    opponent = game.playerUids.find((uid) => uid !== actor)!;
    await fireShot(actor, { gameId: damagedGameId, row: 0, col: 9 });
    await fireShot(opponent, { gameId: damagedGameId, row: 8, col: 0 });
    game = (await refs.game(damagedGameId).get()).data()!;
    actor = game.currentTurnUid!;
    await expectHttpsError(
      useAbility(actor, {
        gameId: damagedGameId,
        abilityId: 'destroyer-relocate',
        target: { row: 9, col: 8, horizontal: true },
      }),
      'failed-precondition',
      'ship for this ability is lost',
    );
  });
});
