/**
 * Callable handlers for the game lifecycle. Every mutation runs in a Firestore transaction so a
 * modified client cannot race the server (fire twice, join twice, etc.). Handlers receive the
 * authenticated uid from the Functions wrapper in index.ts; nothing here trusts client-supplied ids.
 */
import { FieldValue, Timestamp, type Transaction } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { GAME_CONFIG } from '../game/config';
import {
  cellKey,
  isOnBoard,
  shotsToKeySet,
  validateFleet,
  type Coordinate,
  type Shot,
  type ShotResult,
} from '../game/engine';
import type { ShipType } from '../game/config';
import { isBotUid } from '../game/bots';
import { containsChatProfanity } from '../lib/username';
import { chooseShot } from '../game/ai';
import { deriveRng } from '../game/core/rng';
import { reduce, salvoShotsAllowed } from '../game/core/reducer';
import { parseGameModeInput, type GameMode } from '../game/core/schema';
import type {
  AbilityAction,
  AirstrikeTarget,
  RelocateTarget,
  SonarTarget,
} from '../game/core/modes/types';
import { isReactionId, REACTION_COOLDOWN_MS } from '../game/reactions';
import { finishGame } from '../lib/finishGame';
import { coreStateFromGame } from '../lib/coreAdapter';
import { db, refs } from '../lib/firestore';
import { generateJoinCode, normaliseJoinCode } from '../lib/joinCode';
import type { GameDoc, GamePlayer, OpponentDoc, PrivateBoardDoc, UserDoc } from '../types';
import { chooseBotAbilityAction, createBotGameTx } from './bots';

// ---------- shared helpers ----------

export async function requireUser(uid: string, tx?: Transaction): Promise<UserDoc> {
  const snap = tx ? await tx.get(refs.user(uid)) : await refs.user(uid).get();
  const user = snap.data();
  if (!user) throw new HttpsError('failed-precondition', 'Choose a username before playing');
  return user;
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128) {
    throw new HttpsError('invalid-argument', `${name} is required`);
  }
  return value;
}

function opponentOf(game: GameDoc, uid: string): string {
  const other = game.playerUids.find((p) => p !== uid);
  if (!other) throw new HttpsError('failed-precondition', 'No opponent has joined yet');
  return other;
}

function requireMember(game: GameDoc, uid: string): void {
  if (!game.playerUids.includes(uid)) throw new HttpsError('permission-denied', 'You are not in this game');
}

function throwCoreError(error: { code: string; message: string }): never {
  if (error.code === 'not_player') throw new HttpsError('permission-denied', 'You are not in this game');
  if (error.code === 'not_your_turn') throw new HttpsError('failed-precondition', "It's not your turn");
  if (error.code === 'invalid_ability') {
    throw new HttpsError('failed-precondition', error.message);
  }
  if (error.code === 'ability_used') {
    throw new HttpsError('failed-precondition', 'This ability has already been used');
  }
  if (error.code === 'illegal_relocation') {
    throw new HttpsError('invalid-argument', 'Choose a legal placement for your destroyer');
  }
  if (error.code === 'wrong_mode' || error.code === 'wrong_shot_count') {
    throw new HttpsError('failed-precondition', error.message);
  }
  if (error.code === 'duplicate_target') throw new HttpsError('invalid-argument', error.message);
  if (error.code === 'off_board') throw new HttpsError('invalid-argument', 'Target is off the board');
  if (error.code === 'already_fired') {
    throw new HttpsError('failed-precondition', 'You already fired at that cell');
  }
  if (error.code === 'invalid_fleet') throw new HttpsError('invalid-argument', error.message);
  throw new HttpsError('failed-precondition', 'This game is not in progress');
}

export function playerEntry(user: UserDoc): GamePlayer {
  return { username: user.username, rating: user.rating, ready: false, sunkShips: [], shotsFired: 0, hits: 0 };
}

export function newGameDoc(
  hostUid: string,
  host: UserDoc,
  code: string,
  now: Timestamp,
  opts: { isQuickMatch: boolean; mode?: GameMode; rematchOf?: string; invitedUid?: string },
): GameDoc {
  return {
    code,
    status: 'waiting',
    mode: opts.mode ?? 'classic',
    hostUid,
    playerUids: [hostUid],
    players: { [hostUid]: playerEntry(host) },
    shots: { [hostUid]: [] },
    currentTurnUid: null,
    turnNumber: 0,
    winnerUid: null,
    endReason: null,
    ratingChanges: null,
    revealedFleets: null,
    isQuickMatch: opts.isQuickMatch,
    isBotGame: false,
    botDifficulty: null,
    ...(opts.rematchOf ? { rematchOf: opts.rematchOf } : {}),
    ...(opts.invitedUid ? { invitedUid: opts.invitedUid } : {}),
    abandonTimeoutMs: GAME_CONFIG.ABANDON_TIMEOUT_MS,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    finishedAt: null,
    lastMoveAt: now,
  };
}

/** Adds the second player. Mutates and returns the update to apply to the game doc. */
export function joinUpdate(game: GameDoc, uid: string, user: UserDoc, now: Timestamp): Partial<GameDoc> {
  return {
    status: 'placing',
    playerUids: [...game.playerUids, uid],
    players: { ...game.players, [uid]: playerEntry(user) },
    shots: { ...game.shots, [uid]: [] },
    updatedAt: now,
    lastMoveAt: now,
  };
}

export async function reserveJoinCode(tx: Transaction): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateJoinCode();
    const existing = await tx.get(refs.gameCode(code));
    if (!existing.exists) return code;
  }
  throw new HttpsError('internal', 'Could not allocate a join code, please try again');
}

// ---------- createGame ----------

export interface CreateGameResult {
  gameId: string;
  code: string;
}

export async function createGame(uid: string, data?: unknown): Promise<CreateGameResult> {
  const mode = parseGameModeInput((data as { mode?: unknown } | undefined)?.mode);
  if (!mode) throw new HttpsError('invalid-argument', 'Choose a game type');
  return db.runTransaction(async (tx) => {
    const host = await requireUser(uid, tx);
    const code = await reserveJoinCode(tx);
    const now = Timestamp.now();
    const gameRef = refs.games().doc();
    tx.set(gameRef, newGameDoc(uid, host, code, now, { isQuickMatch: false, mode }));
    tx.set(refs.gameCode(code), { gameId: gameRef.id, createdAt: now });
    return { gameId: gameRef.id, code };
  });
}

// ---------- joinGame ----------

export interface JoinGameResult {
  gameId: string;
}

export async function joinGame(uid: string, data: unknown): Promise<JoinGameResult> {
  const input = (data ?? {}) as { code?: unknown };
  const code = normaliseJoinCode(input.code);
  if (!code) throw new HttpsError('invalid-argument', 'Enter the 6-character game code');

  return db.runTransaction(async (tx) => {
    const codeSnap = await tx.get(refs.gameCode(code));
    const codeDoc = codeSnap.data();
    if (!codeDoc) throw new HttpsError('not-found', 'No game found with that code');

    const [gameSnap, user] = await Promise.all([tx.get(refs.game(codeDoc.gameId)), requireUser(uid, tx)]);
    const game = gameSnap.data();
    if (!game) throw new HttpsError('not-found', 'No game found with that code');

    // Rejoin / host opening their own link: just hand back the id.
    if (game.playerUids.includes(uid)) return { gameId: codeDoc.gameId };

    if (game.invitedUid && game.invitedUid !== uid) {
      throw new HttpsError('permission-denied', 'Only the invited player can join this game');
    }
    if (game.status !== 'waiting') throw new HttpsError('failed-precondition', 'That game already has two players');
    if (game.playerUids.length >= 2) throw new HttpsError('failed-precondition', 'That game is full');

    tx.update(refs.game(codeDoc.gameId), joinUpdate(game, uid, user, Timestamp.now()));
    return { gameId: codeDoc.gameId };
  });
}

// ---------- requestRematch ----------

export interface RequestRematchResult {
  gameId: string;
  status: GameDoc['status'];
}

export async function requestRematch(uid: string, data: unknown): Promise<RequestRematchResult> {
  const gameId = requireString((data as { gameId?: unknown } | undefined)?.gameId, 'gameId');

  return db.runTransaction(async (tx) => {
    const gameRef = refs.game(gameId);
    const game = (await tx.get(gameRef)).data();
    if (!game) throw new HttpsError('not-found', 'Game not found');
    requireMember(game, uid);
    if (game.status !== 'finished') throw new HttpsError('failed-precondition', 'The game is not finished');

    if (game.rematch) {
      const existingRef = refs.game(game.rematch.gameId);
      const existing = (await tx.get(existingRef)).data();
      if (existing && existing.status !== 'cancelled') {
        if (game.rematch.requestedBy === uid || existing.playerUids.includes(uid)) {
          return { gameId: game.rematch.gameId, status: existing.status };
        }
        if (existing.status !== 'waiting' || existing.invitedUid !== uid) {
          throw new HttpsError('failed-precondition', 'Rematch expired');
        }
        const user = await requireUser(uid, tx);
        tx.update(existingRef, joinUpdate(existing, uid, user, Timestamp.now()));
        return { gameId: game.rematch.gameId, status: 'placing' };
      }
    }

    if (game.isBotGame) {
      if (!game.botDifficulty) throw new HttpsError('failed-precondition', 'Bot difficulty is missing');
      const newGameId = await createBotGameTx(tx, uid, game.botDifficulty, game.mode ?? 'classic');
      tx.update(gameRef, { rematch: { gameId: newGameId, requestedBy: uid } });
      return { gameId: newGameId, status: 'placing' };
    }

    const invitedUid = opponentOf(game, uid);
    const host = await requireUser(uid, tx);
    const code = await reserveJoinCode(tx);
    const now = Timestamp.now();
    const rematchRef = refs.games().doc();
    const rematch = newGameDoc(uid, host, code, now, {
      isQuickMatch: false,
      mode: game.mode ?? 'classic',
      rematchOf: gameId,
      invitedUid,
    });
    const invitedPlayer = game.players[invitedUid];
    if (invitedPlayer) {
      rematch.players[invitedUid] = {
        username: invitedPlayer.username,
        rating: invitedPlayer.rating,
        ready: false,
        sunkShips: [],
        shotsFired: 0,
        hits: 0,
      };
    }

    tx.set(rematchRef, rematch);
    tx.set(refs.gameCode(code), { gameId: rematchRef.id, createdAt: now });
    tx.update(gameRef, { rematch: { gameId: rematchRef.id, requestedBy: uid } });
    return { gameId: rematchRef.id, status: 'waiting' };
  });
}

// ---------- cancelGame (host, before anyone joins) ----------

export async function cancelGame(uid: string, data: unknown): Promise<void> {
  const gameId = requireString((data as { gameId?: unknown } | undefined)?.gameId, 'gameId');
  await db.runTransaction(async (tx) => {
    const gameRef = refs.game(gameId);
    const game = (await tx.get(gameRef)).data();
    if (!game) throw new HttpsError('not-found', 'Game not found');
    if (game.hostUid !== uid) throw new HttpsError('permission-denied', 'Only the host can cancel');
    if (game.status !== 'waiting') {
      throw new HttpsError('failed-precondition', 'Someone already joined — use resign instead');
    }
    const rematchOfRef = game.rematchOf ? refs.game(game.rematchOf) : null;
    const rematchOf = rematchOfRef ? (await tx.get(rematchOfRef)).data() : undefined;
    const now = Timestamp.now();
    tx.update(gameRef, { status: 'cancelled', finishedAt: now, updatedAt: now });
    tx.delete(refs.gameCode(game.code));
    if (rematchOfRef && rematchOf?.rematch?.gameId === gameId) {
      tx.update(rematchOfRef, { rematch: null });
    }
  });
}

// ---------- placeShips ----------

export interface PlaceShipsResult {
  status: GameDoc['status'];
}

export async function placeShips(uid: string, data: unknown): Promise<PlaceShipsResult> {
  const input = (data ?? {}) as { gameId?: unknown; ships?: unknown };
  const gameId = requireString(input.gameId, 'gameId');
  const validation = validateFleet(input.ships);
  if (!validation.ok) throw new HttpsError('invalid-argument', validation.reason);

  return db.runTransaction(async (tx) => {
    const game = (await tx.get(refs.game(gameId))).data();
    if (!game) throw new HttpsError('not-found', 'Game not found');
    requireMember(game, uid);
    if (game.status === 'waiting') throw new HttpsError('failed-precondition', 'Wait for your opponent to join');
    if (game.status !== 'placing') throw new HttpsError('failed-precondition', 'Ships are already locked in');

    const now = Timestamp.now();
    const board: PrivateBoardDoc = { fleet: validation.fleet, hitCells: [], updatedAt: now };
    tx.set(refs.privateBoard(gameId, uid), board);

    const opponentUid = opponentOf(game, uid);
    const opponentReady = game.players[opponentUid]?.ready === true;
    const update: Record<string, unknown> = {
      [`players.${uid}.ready`]: true,
      updatedAt: now,
      lastMoveAt: now,
    };
    let status: GameDoc['status'] = 'placing';
    if (opponentReady) {
      // Both fleets in: start the turn loop. Against a bot the human always fires first;
      // otherwise pick randomly.
      status = 'active';
      update.status = status;
      update.currentTurnUid = isBotUid(opponentUid) ? uid : Math.random() < 0.5 ? uid : opponentUid;
      update.turnNumber = 1;
      update.startedAt = now;
    }
    tx.update(refs.game(gameId), update);
    return { status };
  });
}

// ---------- fireShot ----------

export interface FireShotResult {
  result: ShotResult;
  sunkShip?: ShipType;
  gameOver: boolean;
  winnerUid: string | null;
}

export async function fireShot(uid: string, data: unknown): Promise<FireShotResult> {
  const input = (data ?? {}) as { gameId?: unknown; row?: unknown; col?: unknown };
  const gameId = requireString(input.gameId, 'gameId');
  const { row, col } = input;

  return db.runTransaction(async (tx) => {
    const game = (await tx.get(refs.game(gameId))).data();
    if (!game) throw new HttpsError('not-found', 'Game not found');
    requireMember(game, uid);
    if (game.status !== 'active') throw new HttpsError('failed-precondition', 'This game is not in progress');
    if (game.mode === 'salvo') {
      throw new HttpsError('failed-precondition', 'This game type needs the latest web app');
    }
    if (typeof row !== 'number' || typeof col !== 'number' || !isOnBoard(row, col)) {
      throw new HttpsError('invalid-argument', 'Target is off the board');
    }
    if (game.currentTurnUid !== uid) throw new HttpsError('failed-precondition', "It's not your turn");

    const myShots = game.shots[uid] ?? [];
    if (shotsToKeySet(myShots).has(cellKey(row, col))) {
      throw new HttpsError('failed-precondition', 'You already fired at that cell');
    }

    const opponentUid = opponentOf(game, uid);
    const [myBoardSnap, opponentBoardSnap] = await Promise.all([
      tx.get(refs.privateBoard(gameId, uid)),
      tx.get(refs.privateBoard(gameId, opponentUid)),
    ]);
    const opponentBoard = opponentBoardSnap.data();
    if (!opponentBoard) throw new HttpsError('internal', 'Opponent board is missing');
    const myBoard = myBoardSnap.data();

    const botOpponent = isBotUid(opponentUid);
    // Against a bot the reply shot (and possibly a bot win) is resolved inside this same
    // transaction, so everything it might need must be read now, before any writes.
    const [meSnap, oppSnap] = botOpponent
      ? await Promise.all([
          tx.get(refs.user(uid)),
          tx.get(refs.user(opponentUid)),
        ])
      : [null, null];

    const now = Timestamp.now();
    const initialState = coreStateFromGame(game, {
      [uid]: myBoard,
      [opponentUid]: opponentBoard,
    });
    const humanResult = reduce(initialState, {
      type: 'fire',
      player: uid,
      target: { row, col },
      at: now.toMillis(),
    });
    if (!humanResult.ok) throwCoreError(humanResult.error);
    const afterHuman = humanResult.state;
    const shot: Shot = afterHuman.shots[uid]!.at(-1)!;
    const outcome = { result: shot.result, sunkShip: shot.sunkShip };

    const isHit = outcome.result !== 'miss';
    const newHits = new Set(afterHuman.boards[opponentUid]!.hitCells);
    const destroyed = afterHuman.phase === 'gameOver' && afterHuman.winner === uid;

    // Public game-doc changes common to every outcome. Only results are stored – never positions
    // of un-hit ships – so the opponent's fleet stays secret until the game ends.
    const gameUpdate: Record<string, unknown> = {
      [`shots.${uid}`]: FieldValue.arrayUnion(shot),
      [`players.${uid}.shotsFired`]: FieldValue.increment(1),
      updatedAt: now,
    };
    if (isHit) gameUpdate[`players.${uid}.hits`] = FieldValue.increment(1);
    if (outcome.sunkShip) gameUpdate[`players.${opponentUid}.sunkShips`] = FieldValue.arrayUnion(outcome.sunkShip);

    if (destroyed) {
      // All reads must precede writes in a transaction, so fetch what finishGame needs first.
      const [meSnap, oppSnap, myBoardSnap, pairSnap] = await Promise.all([
        tx.get(refs.user(uid)),
        tx.get(refs.user(opponentUid)),
        tx.get(refs.privateBoard(gameId, uid)),
        game.isBotGame === true ? null : tx.get(refs.opponent(uid, opponentUid)),
      ]);
      const me = meSnap.data();
      const opp = oppSnap.data();
      if (!me || !opp) throw new HttpsError('internal', 'Player profile missing');

      // finishGame applies stats from game.players, so reflect this final shot there first.
      const gameForStats: GameDoc = {
        ...game,
        players: {
          ...game.players,
          [uid]: {
            ...game.players[uid]!,
            shotsFired: (game.players[uid]?.shotsFired ?? 0) + 1,
            hits: (game.players[uid]?.hits ?? 0) + 1,
          },
        },
      };
      tx.update(refs.privateBoard(gameId, opponentUid), { hitCells: [...newHits], updatedAt: now });
      finishGame({
        tx,
        gameId,
        game: gameForStats,
        winnerUid: uid,
        loserUid: opponentUid,
        reason: 'all_sunk',
        users: { [uid]: me, [opponentUid]: opp },
        fleets: { [uid]: myBoardSnap.data()?.fleet, [opponentUid]: opponentBoard.fleet },
        pairHistory: pairSnap?.data(),
        extraGameFields: gameUpdate,
        now,
      });
      return { result: outcome.result, sunkShip: outcome.sunkShip, gameOver: true, winnerUid: uid };
    }

    if (isHit) tx.update(refs.privateBoard(gameId, opponentUid), { hitCells: [...newHits], updatedAt: now });

    if (botOpponent) {
      const me = meSnap!.data();
      const opp = oppSnap!.data();
      if (!me || !opp || !myBoard) throw new HttpsError('internal', 'Player data missing');

      // The bot replies immediately using only its own shots and public game information.
      const botHistory = afterHuman.shots[opponentUid]!;
      const botRng =
        opponentBoard.rngSeed === undefined
          ? Math.random
          : deriveRng(opponentBoard.rngSeed, 'shot', botHistory.length);
      let botResult;
      if (game.mode === 'abilities') {
        const botAction = chooseBotAbilityAction({
          uid: opponentUid,
          shots: botHistory,
          opponentShots: afterHuman.shots[uid]!,
          abilityLog: afterHuman.abilityLog,
          turnNumber: afterHuman.turnNumber,
          boardSize: GAME_CONFIG.BOARD_SIZE,
          difficulty: game.botDifficulty ?? 'easy',
          rng: botRng,
        });
        if (botAction.type === 'fire') {
          botResult = reduce(afterHuman, {
            type: 'fire',
            player: opponentUid,
            target: botAction.target,
            at: now.toMillis() + 1,
          });
        } else if (botAction.abilityId === 'carrier-airstrike') {
          botResult = reduce(afterHuman, {
            type: 'ability',
            player: opponentUid,
            abilityId: botAction.abilityId,
            target: botAction.target,
            at: now.toMillis() + 1,
          });
        } else {
          botResult = reduce(afterHuman, {
            type: 'ability',
            player: opponentUid,
            abilityId: botAction.abilityId,
            target: botAction.target,
            at: now.toMillis() + 1,
          });
        }
      } else {
        const botTarget = chooseShot({
          shots: botHistory,
          boardSize: GAME_CONFIG.BOARD_SIZE,
          difficulty: game.botDifficulty ?? 'easy',
          rng: botRng,
        });
        botResult = reduce(afterHuman, {
          type: 'fire',
          player: opponentUid,
          target: botTarget,
          at: now.toMillis() + 1,
        });
      }
      if (!botResult.ok) throwCoreError(botResult.error);
      const afterBot = botResult.state;
      const botShots = afterBot.shots[opponentUid]!.slice(botHistory.length);
      const botHits = botShots.filter((botShot) => botShot.result !== 'miss').length;
      const fleetLost = afterBot.phase === 'gameOver' && afterBot.winner === opponentUid;

      if (botShots.length > 0) {
        gameUpdate[`shots.${opponentUid}`] = FieldValue.arrayUnion(...botShots);
        gameUpdate[`players.${opponentUid}.shotsFired`] = FieldValue.increment(botShots.length);
      }
      if (botHits > 0) gameUpdate[`players.${opponentUid}.hits`] = FieldValue.increment(botHits);
      const sunkShips = [...new Set(botShots.flatMap((botShot) => (botShot.sunkShip ? [botShot.sunkShip] : [])))];
      if (sunkShips.length > 0) {
        gameUpdate[`players.${uid}.sunkShips`] = FieldValue.arrayUnion(...sunkShips);
      }
      if (afterBot.abilityLog.length !== afterHuman.abilityLog.length) {
        gameUpdate.abilityLog = afterBot.abilityLog;
      }
      gameUpdate.currentTurnUid = afterBot.currentTurn;
      gameUpdate.turnNumber = afterBot.turnNumber;
      gameUpdate.lastMoveAt = now;

      if (botHits > 0) {
        tx.update(refs.privateBoard(gameId, uid), {
          hitCells: [...afterBot.boards[uid]!.hitCells],
          updatedAt: now,
        });
      }

      if (fleetLost) {
        // finishGame applies stats from game.players, so reflect both final shots there first.
        const gameForStats: GameDoc = {
          ...game,
          players: {
            ...game.players,
            [uid]: {
              ...game.players[uid]!,
              shotsFired: (game.players[uid]?.shotsFired ?? 0) + 1,
              hits: (game.players[uid]?.hits ?? 0) + (isHit ? 1 : 0),
            },
            [opponentUid]: {
              ...game.players[opponentUid]!,
              shotsFired: (game.players[opponentUid]?.shotsFired ?? 0) + botShots.length,
              hits: (game.players[opponentUid]?.hits ?? 0) + botHits,
            },
          },
        };
        finishGame({
          tx,
          gameId,
          game: gameForStats,
          winnerUid: opponentUid,
          loserUid: uid,
          reason: 'all_sunk',
          users: { [uid]: me, [opponentUid]: opp },
          fleets: { [uid]: myBoard.fleet, [opponentUid]: opponentBoard.fleet },
          extraGameFields: gameUpdate,
          now,
        });
        return { result: outcome.result, sunkShip: outcome.sunkShip, gameOver: true, winnerUid: opponentUid };
      }

      tx.update(refs.game(gameId), gameUpdate);
      return { result: outcome.result, sunkShip: outcome.sunkShip, gameOver: false, winnerUid: null };
    }

    gameUpdate.currentTurnUid = opponentUid;
    gameUpdate.turnNumber = FieldValue.increment(1);
    gameUpdate.lastMoveAt = now;
    tx.update(refs.game(gameId), gameUpdate);

    return { result: outcome.result, sunkShip: outcome.sunkShip, gameOver: false, winnerUid: null };
  });
}

export interface FireSalvoResult {
  gameOver: boolean;
  winnerUid: string | null;
}

export async function fireSalvo(uid: string, data: unknown): Promise<FireSalvoResult> {
  const input = (data ?? {}) as { gameId?: unknown; targets?: unknown };
  const gameId = requireString(input.gameId, 'gameId');
  if (
    !Array.isArray(input.targets) ||
    input.targets.some(
      (target) =>
        typeof target !== 'object' ||
        target === null ||
        typeof (target as Record<string, unknown>).row !== 'number' ||
        typeof (target as Record<string, unknown>).col !== 'number',
    )
  ) {
    throw new HttpsError('invalid-argument', 'Targets must be a list of board coordinates');
  }
  const targets = input.targets as Coordinate[];

  return db.runTransaction(async (tx) => {
    const game = (await tx.get(refs.game(gameId))).data();
    if (!game) throw new HttpsError('not-found', 'Game not found');
    requireMember(game, uid);
    if (game.status !== 'active') throw new HttpsError('failed-precondition', 'This game is not in progress');
    if (game.currentTurnUid !== uid) throw new HttpsError('failed-precondition', "It's not your turn");

    const opponentUid = opponentOf(game, uid);
    const [myBoardSnap, opponentBoardSnap] = await Promise.all([
      tx.get(refs.privateBoard(gameId, uid)),
      tx.get(refs.privateBoard(gameId, opponentUid)),
    ]);
    const myBoard = myBoardSnap.data();
    const opponentBoard = opponentBoardSnap.data();
    if (!opponentBoard) throw new HttpsError('internal', 'Opponent board is missing');

    const botOpponent = isBotUid(opponentUid);
    const [meSnap, oppSnap] = botOpponent
      ? await Promise.all([tx.get(refs.user(uid)), tx.get(refs.user(opponentUid))])
      : [null, null];

    const now = Timestamp.now();
    const initialState = coreStateFromGame(game, {
      [uid]: myBoard,
      [opponentUid]: opponentBoard,
    });
    const humanResult = reduce(initialState, {
      type: 'salvo',
      player: uid,
      targets,
      at: now.toMillis(),
    });
    if (!humanResult.ok) throwCoreError(humanResult.error);
    let finalState = humanResult.state;
    const humanShots = finalState.shots[uid]!.slice(initialState.shots[uid]!.length);
    const humanHits = humanShots.filter((shot) => shot.result !== 'miss').length;
    let botShots: Shot[] = [];
    let botHits = 0;

    if (botOpponent && finalState.phase === 'playing') {
      const botShotCount = salvoShotsAllowed(finalState, opponentUid);
      const botHistory = initialState.shots[opponentUid]!;
      const botShotIndex = botHistory.length;
      const exclude = new Set<string>();
      const botTargets: Coordinate[] = [];
      for (let index = 0; index < botShotCount; index++) {
        const target = chooseShot({
          shots: botHistory,
          boardSize: GAME_CONFIG.BOARD_SIZE,
          difficulty: game.botDifficulty ?? 'easy',
          rng:
            opponentBoard.rngSeed === undefined
              ? Math.random
              : deriveRng(opponentBoard.rngSeed, 'shot', botShotIndex + index),
          exclude,
        });
        botTargets.push(target);
        exclude.add(cellKey(target.row, target.col));
      }
      const botResult = reduce(finalState, {
        type: 'salvo',
        player: opponentUid,
        targets: botTargets,
        at: now.toMillis() + 1,
      });
      if (!botResult.ok) throwCoreError(botResult.error);
      finalState = botResult.state;
      botShots = finalState.shots[opponentUid]!.slice(botHistory.length);
      botHits = botShots.filter((shot) => shot.result !== 'miss').length;
    }

    const gameUpdate: Record<string, unknown> = {
      updatedAt: now,
      lastMoveAt: now,
      currentTurnUid: finalState.currentTurn,
      turnNumber: finalState.turnNumber,
    };
    const addVolley = (shooter: string, shots: Shot[], victim: string) => {
      if (shots.length === 0) return;
      gameUpdate[`shots.${shooter}`] = FieldValue.arrayUnion(...shots);
      gameUpdate[`players.${shooter}.shotsFired`] = FieldValue.increment(shots.length);
      const hits = shots.filter((shot) => shot.result !== 'miss').length;
      if (hits > 0) gameUpdate[`players.${shooter}.hits`] = FieldValue.increment(hits);
      const sunkShips = [...new Set(shots.flatMap((shot) => (shot.sunkShip ? [shot.sunkShip] : [])))];
      if (sunkShips.length > 0) {
        gameUpdate[`players.${victim}.sunkShips`] = FieldValue.arrayUnion(...sunkShips);
      }
    };
    addVolley(uid, humanShots, opponentUid);
    addVolley(opponentUid, botShots, uid);

    if (finalState.phase === 'gameOver') {
      const winnerUid = finalState.winner!;
      const loserUid = winnerUid === uid ? opponentUid : uid;
      let me = meSnap?.data();
      let opponent = oppSnap?.data();
      let pairHistory: OpponentDoc | undefined;
      if (!botOpponent) {
        const [meDoc, opponentDoc, pairSnap] = await Promise.all([
          tx.get(refs.user(uid)),
          tx.get(refs.user(opponentUid)),
          tx.get(refs.opponent(uid, opponentUid)),
        ]);
        me = meDoc.data();
        opponent = opponentDoc.data();
        pairHistory = pairSnap.data();
      }
      if (!me || !opponent) throw new HttpsError('internal', 'Player profile missing');

      if (humanHits > 0) {
        tx.update(refs.privateBoard(gameId, opponentUid), {
          hitCells: [...finalState.boards[opponentUid]!.hitCells],
          updatedAt: now,
        });
      }
      if (botHits > 0) {
        tx.update(refs.privateBoard(gameId, uid), {
          hitCells: [...finalState.boards[uid]!.hitCells],
          updatedAt: now,
        });
      }
      const players = {
        ...game.players,
        [uid]: {
          ...game.players[uid]!,
          shotsFired: (game.players[uid]?.shotsFired ?? 0) + humanShots.length,
          hits: (game.players[uid]?.hits ?? 0) + humanHits,
        },
        ...(botShots.length > 0
          ? {
              [opponentUid]: {
                ...game.players[opponentUid]!,
                shotsFired: (game.players[opponentUid]?.shotsFired ?? 0) + botShots.length,
                hits: (game.players[opponentUid]?.hits ?? 0) + botHits,
              },
            }
          : {}),
      };
      finishGame({
        tx,
        gameId,
        game: { ...game, players },
        winnerUid,
        loserUid,
        reason: 'all_sunk',
        users: { [uid]: me, [opponentUid]: opponent },
        fleets: { [uid]: myBoard?.fleet, [opponentUid]: opponentBoard.fleet },
        pairHistory,
        extraGameFields: gameUpdate,
        now,
      });
      return { gameOver: true, winnerUid };
    }

    if (humanHits > 0) {
      tx.update(refs.privateBoard(gameId, opponentUid), {
        hitCells: [...finalState.boards[opponentUid]!.hitCells],
        updatedAt: now,
      });
    }
    if (botHits > 0) {
      tx.update(refs.privateBoard(gameId, uid), {
        hitCells: [...finalState.boards[uid]!.hitCells],
        updatedAt: now,
      });
    }
    tx.update(refs.game(gameId), gameUpdate);
    return { gameOver: false, winnerUid: null };
  });
}

type ParsedAbilityInput =
  | { gameId: string; abilityId: 'carrier-airstrike'; target: AirstrikeTarget }
  | { gameId: string; abilityId: 'submarine-sonar'; target: SonarTarget }
  | { gameId: string; abilityId: 'destroyer-relocate'; target: RelocateTarget };

function parseAbilityInput(data: unknown): ParsedAbilityInput {
  const input = (data ?? {}) as Record<string, unknown>;
  const gameId = requireString(input.gameId, 'gameId');
  const abilityId = input.abilityId;
  const target = input.target;
  if (typeof target !== 'object' || target === null || Array.isArray(target)) {
    throw new HttpsError('invalid-argument', 'Target must include integer row and col coordinates');
  }
  const { row, col } = target as Record<string, unknown>;
  if (!Number.isInteger(row) || !Number.isInteger(col)) {
    throw new HttpsError('invalid-argument', 'Target must include integer row and col coordinates');
  }
  const coordinate = { row: row as number, col: col as number };

  if (abilityId === 'carrier-airstrike') {
    const horizontal = (target as Record<string, unknown>).horizontal;
    if (typeof horizontal !== 'boolean') {
      throw new HttpsError('invalid-argument', 'Target must include a horizontal boolean');
    }
    return { gameId, abilityId, target: { ...coordinate, horizontal } };
  }
  if (abilityId === 'destroyer-relocate') {
    const horizontal = (target as Record<string, unknown>).horizontal;
    if (typeof horizontal !== 'boolean') {
      throw new HttpsError('invalid-argument', 'Target must include a horizontal boolean');
    }
    return { gameId, abilityId, target: { ...coordinate, horizontal } };
  }
  if (abilityId === 'submarine-sonar') return { gameId, abilityId, target: coordinate };
  throw new HttpsError(
    'invalid-argument',
    'Ability must be carrier-airstrike, submarine-sonar, or destroyer-relocate',
  );
}

function toAbilityAction(
  player: string,
  input: ParsedAbilityInput,
  at: number,
): AbilityAction {
  switch (input.abilityId) {
    case 'carrier-airstrike':
      return { type: 'ability', player, abilityId: input.abilityId, target: input.target, at };
    case 'submarine-sonar':
      return { type: 'ability', player, abilityId: input.abilityId, target: input.target, at };
    case 'destroyer-relocate':
      return { type: 'ability', player, abilityId: input.abilityId, target: input.target, at };
  }
}

export interface UseAbilityResult {
  gameOver: boolean;
  winnerUid: string | null;
}

export async function useAbility(uid: string, data: unknown): Promise<UseAbilityResult> {
  const input = parseAbilityInput(data);
  const { gameId, abilityId } = input;

  return db.runTransaction(async (tx) => {
    const game = (await tx.get(refs.game(gameId))).data();
    if (!game) throw new HttpsError('not-found', 'Game not found');
    requireMember(game, uid);
    if (game.status !== 'active') throw new HttpsError('failed-precondition', 'This game is not in progress');
    if (game.currentTurnUid !== uid) throw new HttpsError('failed-precondition', "It's not your turn");

    const opponentUid = opponentOf(game, uid);
    const [myBoardSnap, opponentBoardSnap] = await Promise.all([
      tx.get(refs.privateBoard(gameId, uid)),
      tx.get(refs.privateBoard(gameId, opponentUid)),
    ]);
    const myBoard = myBoardSnap.data();
    const opponentBoard = opponentBoardSnap.data();
    if (!myBoard || !opponentBoard) throw new HttpsError('internal', 'A player board is missing');

    const botOpponent = isBotUid(opponentUid);
    const [meSnap, opponentSnap] = botOpponent
      ? await Promise.all([tx.get(refs.user(uid)), tx.get(refs.user(opponentUid))])
      : [null, null];
    const now = Timestamp.now();
    const initialState = coreStateFromGame(game, { [uid]: myBoard, [opponentUid]: opponentBoard });
    const action = toAbilityAction(uid, input, now.toMillis());
    const abilityResult = reduce(initialState, action);
    if (!abilityResult.ok) throwCoreError(abilityResult.error);

    let finalState = abilityResult.state;
    const humanShots = finalState.shots[uid]!.slice(initialState.shots[uid]!.length);
    let botShots: Shot[] = [];
    if (botOpponent && finalState.phase === 'playing') {
      const botHistory = finalState.shots[opponentUid]!;
      const botAction = chooseBotAbilityAction({
        uid: opponentUid,
        shots: botHistory,
        opponentShots: finalState.shots[uid]!,
        abilityLog: finalState.abilityLog,
        turnNumber: finalState.turnNumber,
        boardSize: GAME_CONFIG.BOARD_SIZE,
        difficulty: game.botDifficulty ?? 'easy',
        rng:
          opponentBoard.rngSeed === undefined
            ? Math.random
            : deriveRng(opponentBoard.rngSeed, 'shot', botHistory.length),
      });
      let botResult;
      if (botAction.type === 'fire') {
        botResult = reduce(finalState, {
          type: 'fire',
          player: opponentUid,
          target: botAction.target,
          at: now.toMillis() + 1,
        });
      } else if (botAction.abilityId === 'carrier-airstrike') {
        botResult = reduce(finalState, {
          type: 'ability',
          player: opponentUid,
          abilityId: botAction.abilityId,
          target: botAction.target,
          at: now.toMillis() + 1,
        });
      } else {
        botResult = reduce(finalState, {
          type: 'ability',
          player: opponentUid,
          abilityId: botAction.abilityId,
          target: botAction.target,
          at: now.toMillis() + 1,
        });
      }
      if (!botResult.ok) throwCoreError(botResult.error);
      finalState = botResult.state;
      botShots = finalState.shots[opponentUid]!.slice(botHistory.length);
    }

    const humanHits = humanShots.filter((shot) => shot.result !== 'miss').length;
    const botHits = botShots.filter((shot) => shot.result !== 'miss').length;
    const gameUpdate: Record<string, unknown> = {
      abilityLog: finalState.abilityLog,
      currentTurnUid: finalState.currentTurn,
      turnNumber: finalState.turnNumber,
      lastMoveAt: now,
      updatedAt: now,
    };
    const addShots = (shooter: string, victim: string, shots: Shot[]) => {
      if (shots.length === 0) return;
      gameUpdate[`shots.${shooter}`] = FieldValue.arrayUnion(...shots);
      gameUpdate[`players.${shooter}.shotsFired`] = FieldValue.increment(shots.length);
      const hits = shots.filter((shot) => shot.result !== 'miss').length;
      if (hits > 0) gameUpdate[`players.${shooter}.hits`] = FieldValue.increment(hits);
      const sunkShips = [...new Set(shots.flatMap((shot) => (shot.sunkShip ? [shot.sunkShip] : [])))];
      if (sunkShips.length > 0) {
        gameUpdate[`players.${victim}.sunkShips`] = FieldValue.arrayUnion(...sunkShips);
      }
    };
    addShots(uid, opponentUid, humanShots);
    addShots(opponentUid, uid, botShots);

    const gameOver = finalState.phase === 'gameOver';
    if (gameOver) {
      const finalWinnerUid = finalState.winner!;
      let me = meSnap?.data();
      let opponent = opponentSnap?.data();
      let pairHistory: OpponentDoc | undefined;
      if (!botOpponent) {
        const [meDoc, opponentDoc, pairSnap] = await Promise.all([
          tx.get(refs.user(uid)),
          tx.get(refs.user(opponentUid)),
          tx.get(refs.opponent(uid, opponentUid)),
        ]);
        me = meDoc.data();
        opponent = opponentDoc.data();
        pairHistory = pairSnap.data();
      }
      if (!me || !opponent) throw new HttpsError('internal', 'Player profile missing');
      const finalMyFleet = finalState.boards[uid]!.fleet;
      const finalOpponentFleet = finalState.boards[opponentUid]!.fleet;
      if (!finalMyFleet || !finalOpponentFleet) throw new HttpsError('internal', 'A player fleet is missing');

      if (abilityId === 'destroyer-relocate') {
        tx.update(refs.privateBoard(gameId, uid), {
          fleet: finalState.boards[uid]!.fleet,
          updatedAt: now,
        });
      }
      if (humanHits > 0) {
        tx.update(refs.privateBoard(gameId, opponentUid), {
          hitCells: [...finalState.boards[opponentUid]!.hitCells],
          updatedAt: now,
        });
      }
      if (botHits > 0) {
        tx.update(refs.privateBoard(gameId, uid), {
          hitCells: [...finalState.boards[uid]!.hitCells],
          updatedAt: now,
        });
      }
      const players = {
        ...game.players,
        [uid]: {
          ...game.players[uid]!,
          shotsFired: (game.players[uid]?.shotsFired ?? 0) + humanShots.length,
          hits: (game.players[uid]?.hits ?? 0) + humanHits,
        },
        ...(botShots.length > 0
          ? {
              [opponentUid]: {
                ...game.players[opponentUid]!,
                shotsFired: (game.players[opponentUid]?.shotsFired ?? 0) + botShots.length,
                hits: (game.players[opponentUid]?.hits ?? 0) + botHits,
              },
            }
          : {}),
      };
      finishGame({
        tx,
        gameId,
        game: { ...game, players },
        winnerUid: finalWinnerUid,
        loserUid: finalWinnerUid === uid ? opponentUid : uid,
        reason: 'all_sunk',
        users: { [uid]: me, [opponentUid]: opponent },
        fleets: { [uid]: finalMyFleet, [opponentUid]: finalOpponentFleet },
        pairHistory,
        extraGameFields: gameUpdate,
        now,
      });
      return { gameOver: true, winnerUid: finalWinnerUid };
    }

    if (abilityId === 'destroyer-relocate') {
      tx.update(refs.privateBoard(gameId, uid), {
        fleet: finalState.boards[uid]!.fleet,
        updatedAt: now,
      });
    }
    if (humanHits > 0) {
      tx.update(refs.privateBoard(gameId, opponentUid), {
        hitCells: [...finalState.boards[opponentUid]!.hitCells],
        updatedAt: now,
      });
    }
    if (botHits > 0) {
      tx.update(refs.privateBoard(gameId, uid), {
        hitCells: [...finalState.boards[uid]!.hitCells],
        updatedAt: now,
      });
    }
    tx.update(refs.game(gameId), gameUpdate);
    return { gameOver: false, winnerUid: null };
  });
}

// ---------- sendChatMessage ----------

const CHAT_MAX_LENGTH = 240;
const CHAT_COOLDOWN_MS = 1_000;

export async function sendChatMessage(uid: string, data: unknown): Promise<void> {
  const input = (data ?? {}) as { gameId?: unknown; text?: unknown };
  const gameId = requireString(input.gameId, 'gameId');
  if (typeof input.text !== 'string') throw new HttpsError('invalid-argument', 'Message is required');
  const text = input.text.trim();
  if (!text) throw new HttpsError('invalid-argument', 'Message is required');
  if (text.length > CHAT_MAX_LENGTH) {
    throw new HttpsError('invalid-argument', `Messages must be ${CHAT_MAX_LENGTH} characters or fewer`);
  }
  if (containsChatProfanity(text)) throw new HttpsError('invalid-argument', 'That message is not allowed');

  await db.runTransaction(async (tx) => {
    const gameRef = refs.game(gameId);
    const chatStateRef = refs.chatState(gameId, uid);
    const [gameSnap, chatStateSnap] = await Promise.all([tx.get(gameRef), tx.get(chatStateRef)]);
    const game = gameSnap.data();
    if (!game) throw new HttpsError('not-found', 'Game not found');
    requireMember(game, uid);
    if (game.status !== 'active') throw new HttpsError('failed-precondition', 'Chat is available during active games');
    if (game.isBotGame) throw new HttpsError('failed-precondition', 'Computer games use automated commentary');

    const lastAt = chatStateSnap.data()?.lastAt ?? 0;
    const now = Timestamp.now();
    if (now.toMillis() - lastAt < CHAT_COOLDOWN_MS) {
      throw new HttpsError('resource-exhausted', 'Wait a moment before sending another message');
    }

    const username = game.players[uid]?.username;
    if (!username) throw new HttpsError('failed-precondition', 'Player profile is missing');
    tx.create(refs.chatMessages(gameId).doc(), { uid, username, text, at: now });
    tx.set(chatStateRef, { lastAt: now.toMillis() });
  });
}

// ---------- resign / claimTimeoutWin ----------

interface EndByRuleInput {
  gameId: string;
  winnerUid: string;
  loserUid: string;
  reason: 'resign' | 'timeout';
}

/** Shared tail for resign and timeout: reads users + boards, then finishes the game. */
async function endGameByRule(tx: Transaction, game: GameDoc, input: EndByRuleInput): Promise<void> {
  const { gameId, winnerUid, loserUid, reason } = input;
  const [winnerSnap, loserSnap, winnerBoard, loserBoard, pairSnap] = await Promise.all([
    tx.get(refs.user(winnerUid)),
    tx.get(refs.user(loserUid)),
    tx.get(refs.privateBoard(gameId, winnerUid)),
    tx.get(refs.privateBoard(gameId, loserUid)),
    game.isBotGame === true ? null : tx.get(refs.opponent(winnerUid, loserUid)),
  ]);
  const winner = winnerSnap.data();
  const loser = loserSnap.data();
  if (!winner || !loser) throw new HttpsError('internal', 'Player profile missing');
  finishGame({
    tx,
    gameId,
    game,
    winnerUid,
    loserUid,
    reason,
    users: { [winnerUid]: winner, [loserUid]: loser },
    fleets: { [winnerUid]: winnerBoard.data()?.fleet, [loserUid]: loserBoard.data()?.fleet },
    pairHistory: pairSnap?.data(),
    now: Timestamp.now(),
  });
}

export interface EndGameResult {
  winnerUid: string;
}

/** Forfeit. Allowed once an opponent has joined (placing or active). Counts as a loss. */
export async function resign(uid: string, data: unknown): Promise<EndGameResult> {
  const gameId = requireString((data as { gameId?: unknown } | undefined)?.gameId, 'gameId');
  return db.runTransaction(async (tx) => {
    const game = (await tx.get(refs.game(gameId))).data();
    if (!game) throw new HttpsError('not-found', 'Game not found');
    requireMember(game, uid);
    if (game.status === 'waiting') throw new HttpsError('failed-precondition', 'Nobody has joined — cancel the game instead');
    if (game.status !== 'placing' && game.status !== 'active') {
      throw new HttpsError('failed-precondition', 'This game is already over');
    }
    const winnerUid = opponentOf(game, uid);
    await endGameByRule(tx, game, { gameId, winnerUid, loserUid: uid, reason: 'resign' });
    return { winnerUid };
  });
}

/**
 * Lets the player who is waiting on an inactive opponent claim the win once the game's
 * abandonment timeout (default 3 days) has elapsed since the last progress.
 */
export async function claimTimeoutWin(uid: string, data: unknown): Promise<EndGameResult> {
  const gameId = requireString((data as { gameId?: unknown } | undefined)?.gameId, 'gameId');
  return db.runTransaction(async (tx) => {
    const game = (await tx.get(refs.game(gameId))).data();
    if (!game) throw new HttpsError('not-found', 'Game not found');
    requireMember(game, uid);
    if (game.status !== 'placing' && game.status !== 'active') {
      throw new HttpsError('failed-precondition', 'This game is not in progress');
    }
    const opponentUid = opponentOf(game, uid);
    if (isBotUid(opponentUid)) throw new HttpsError('failed-precondition', 'The computer never times out');

    // The claimant must be the one waiting: in the active phase it must be the opponent's turn; in
    // the placing phase the claimant must have placed while the opponent has not.
    const opponentIsStalling =
      game.status === 'active'
        ? game.currentTurnUid === opponentUid
        : game.players[uid]?.ready === true && game.players[opponentUid]?.ready !== true;
    if (!opponentIsStalling) throw new HttpsError('failed-precondition', "You can only claim while waiting on your opponent");

    const last = game.lastMoveAt?.toMillis() ?? game.createdAt.toMillis();
    const elapsed = Date.now() - last;
    if (elapsed < game.abandonTimeoutMs) {
      const hoursLeft = Math.ceil((game.abandonTimeoutMs - elapsed) / 3_600_000);
      throw new HttpsError('failed-precondition', `Your opponent still has about ${hoursLeft}h to move`);
    }

    await endGameByRule(tx, game, { gameId, winnerUid: uid, loserUid: opponentUid, reason: 'timeout' });
    return { winnerUid: uid };
  });
}

// ---------- sendReaction ----------
export async function sendReaction(uid: string, data: unknown): Promise<void> {
  const input = data as { gameId?: unknown; reactionId?: unknown } | undefined;
  const gameId = requireString(input?.gameId, 'gameId');
  if (!isReactionId(input?.reactionId)) throw new HttpsError('invalid-argument', 'Unknown reaction');
  const reactionId = input.reactionId;

  await db.runTransaction(async (tx) => {
    const game = (await tx.get(refs.game(gameId))).data();
    if (!game) throw new HttpsError('not-found', 'Game not found');
    requireMember(game, uid);
    if (game.status !== 'placing' && game.status !== 'active' && game.status !== 'finished') {
      throw new HttpsError('failed-precondition', 'Reactions are only available during a game');
    }

    const latest = await tx.get(refs.reactions(gameId).where('uid', '==', uid).orderBy('at', 'desc').limit(1));
    const now = Timestamp.now();
    const lastReaction = latest.docs[0]?.data();
    if (lastReaction && now.toMillis() - lastReaction.at.toMillis() < REACTION_COOLDOWN_MS) {
      throw new HttpsError('resource-exhausted', 'Slow down — one reaction every 10 seconds');
    }
    tx.create(refs.reactions(gameId).doc(), { uid, reactionId, at: now });
  });
}
