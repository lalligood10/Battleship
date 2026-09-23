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
  isFleetDestroyed,
  isOnBoard,
  resolveShot,
  shotsToKeySet,
  validateFleet,
  type Shot,
  type ShotResult,
} from '../game/engine';
import type { ShipType } from '../game/config';
import { finishGame } from '../lib/finishGame';
import { db, refs } from '../lib/firestore';
import { generateJoinCode, normaliseJoinCode } from '../lib/joinCode';
import type { GameDoc, GamePlayer, PrivateBoardDoc, UserDoc } from '../types';

// ---------- shared helpers ----------

async function requireUser(uid: string, tx?: Transaction): Promise<UserDoc> {
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

function playerEntry(user: UserDoc): GamePlayer {
  return { username: user.username, rating: user.rating, ready: false, sunkShips: [], shotsFired: 0, hits: 0 };
}

export function newGameDoc(
  hostUid: string,
  host: UserDoc,
  code: string,
  now: Timestamp,
  opts: { isQuickMatch: boolean },
): GameDoc {
  return {
    code,
    status: 'waiting',
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

async function reserveJoinCode(tx: Transaction): Promise<string> {
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

export async function createGame(uid: string): Promise<CreateGameResult> {
  return db.runTransaction(async (tx) => {
    const host = await requireUser(uid, tx);
    const code = await reserveJoinCode(tx);
    const now = Timestamp.now();
    const gameRef = refs.games().doc();
    tx.set(gameRef, newGameDoc(uid, host, code, now, { isQuickMatch: false }));
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

    if (game.status !== 'waiting') throw new HttpsError('failed-precondition', 'That game already has two players');
    if (game.playerUids.length >= 2) throw new HttpsError('failed-precondition', 'That game is full');

    tx.update(refs.game(codeDoc.gameId), joinUpdate(game, uid, user, Timestamp.now()));
    return { gameId: codeDoc.gameId };
  });
}

// ---------- cancelGame (host, before anyone joins) ----------

export async function cancelGame(uid: string, data: unknown): Promise<void> {
  const gameId = requireString((data as { gameId?: unknown } | undefined)?.gameId, 'gameId');
  await db.runTransaction(async (tx) => {
    const game = (await tx.get(refs.game(gameId))).data();
    if (!game) throw new HttpsError('not-found', 'Game not found');
    if (game.hostUid !== uid) throw new HttpsError('permission-denied', 'Only the host can cancel');
    if (game.status !== 'waiting') {
      throw new HttpsError('failed-precondition', 'Someone already joined — use resign instead');
    }
    const now = Timestamp.now();
    tx.update(refs.game(gameId), { status: 'cancelled', finishedAt: now, updatedAt: now });
    tx.delete(refs.gameCode(game.code));
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
      // Both fleets in: pick a random first player and start the turn loop.
      status = 'active';
      update.status = status;
      update.currentTurnUid = Math.random() < 0.5 ? uid : opponentUid;
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
  if (typeof row !== 'number' || typeof col !== 'number' || !isOnBoard(row, col)) {
    throw new HttpsError('invalid-argument', 'Target is off the board');
  }

  return db.runTransaction(async (tx) => {
    const game = (await tx.get(refs.game(gameId))).data();
    if (!game) throw new HttpsError('not-found', 'Game not found');
    requireMember(game, uid);
    if (game.status !== 'active') throw new HttpsError('failed-precondition', 'This game is not in progress');
    if (game.currentTurnUid !== uid) throw new HttpsError('failed-precondition', "It's not your turn");

    const myShots = game.shots[uid] ?? [];
    if (shotsToKeySet(myShots).has(cellKey(row, col))) {
      throw new HttpsError('failed-precondition', 'You already fired at that cell');
    }

    const opponentUid = opponentOf(game, uid);
    const opponentBoard = (await tx.get(refs.privateBoard(gameId, opponentUid))).data();
    if (!opponentBoard) throw new HttpsError('internal', 'Opponent board is missing');

    const previousHits = new Set(opponentBoard.hitCells);
    const outcome = resolveShot(opponentBoard.fleet, previousHits, { row, col });
    const now = Timestamp.now();
    const shot: Shot = { row, col, result: outcome.result, at: now.toMillis() };
    if (outcome.sunkShip) shot.sunkShip = outcome.sunkShip;

    const isHit = outcome.result !== 'miss';
    const newHits = isHit ? new Set([...previousHits, cellKey(row, col)]) : previousHits;
    const destroyed = isHit && isFleetDestroyed(opponentBoard.fleet, newHits);

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
      const [meSnap, oppSnap, myBoardSnap] = await Promise.all([
        tx.get(refs.user(uid)),
        tx.get(refs.user(opponentUid)),
        tx.get(refs.privateBoard(gameId, uid)),
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
        extraGameFields: gameUpdate,
        now,
      });
      return { result: outcome.result, sunkShip: outcome.sunkShip, gameOver: true, winnerUid: uid };
    }

    if (isHit) tx.update(refs.privateBoard(gameId, opponentUid), { hitCells: [...newHits], updatedAt: now });
    gameUpdate.currentTurnUid = opponentUid;
    gameUpdate.turnNumber = FieldValue.increment(1);
    gameUpdate.lastMoveAt = now;
    tx.update(refs.game(gameId), gameUpdate);

    return { result: outcome.result, sunkShip: outcome.sunkShip, gameOver: false, winnerUid: null };
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
  const [winnerSnap, loserSnap, winnerBoard, loserBoard] = await Promise.all([
    tx.get(refs.user(winnerUid)),
    tx.get(refs.user(loserUid)),
    tx.get(refs.privateBoard(gameId, winnerUid)),
    tx.get(refs.privateBoard(gameId, loserUid)),
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
