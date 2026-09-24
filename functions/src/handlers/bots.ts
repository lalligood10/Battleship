/**
 * "Play vs Computer": creates a game against a server-side bot. The bot's profile is a normal
 * users/{uid} doc flagged isBot so the rest of the stack (players map, shots, security rules)
 * treats it like any other player; its fleet lives in the usual private board doc.
 */
import { Timestamp, type Transaction } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { BOT_PROFILES, parseDifficulty, type BotDifficulty } from '../game/bots';
import { randomFleet } from '../game/engine';
import { EMPTY_STATS } from '../game/scoring';
import { db, refs } from '../lib/firestore';
import type { PrivateBoardDoc, UserDoc } from '../types';
import { joinUpdate, newGameDoc, requireUser, reserveJoinCode } from './games';

/** Creates the bot's users/{uid} + usernames/ docs on first use. Idempotent. */
export async function ensureBotProfile(tx: Transaction, difficulty: BotDifficulty): Promise<UserDoc> {
  const profile = BOT_PROFILES[difficulty];
  const ref = refs.user(profile.uid);
  const existing = (await tx.get(ref)).data();
  if (existing) return existing;

  const now = Timestamp.now();
  const user: UserDoc = {
    username: profile.username,
    usernameLower: profile.usernameLower,
    rating: profile.rating,
    stats: EMPTY_STATS,
    isBot: true,
    botStats: EMPTY_STATS,
    createdAt: now,
    updatedAt: now,
    lastGameAt: null,
  };
  tx.set(ref, user);
  tx.set(refs.username(profile.usernameLower), { uid: profile.uid });
  return user;
}

export interface CreateBotGameResult {
  gameId: string;
}

export async function createBotGame(uid: string, data: unknown): Promise<CreateBotGameResult> {
  const difficulty = parseDifficulty((data as { difficulty?: unknown } | undefined)?.difficulty);
  if (!difficulty) throw new HttpsError('invalid-argument', 'Choose a difficulty: easy, medium or hard');
  const bot = BOT_PROFILES[difficulty];

  return db.runTransaction(async (tx) => {
    // Reads first (transactions forbid reads after writes): user, join code, then the bot profile.
    const host = await requireUser(uid, tx);
    const code = await reserveJoinCode(tx);
    const botUser = await ensureBotProfile(tx, difficulty);

    const now = Timestamp.now();
    const gameRef = refs.games().doc();
    const base = newGameDoc(uid, host, code, now, { isQuickMatch: false });
    const doc = { ...base, ...joinUpdate(base, bot.uid, botUser, now) };
    doc.players[bot.uid] = { ...doc.players[bot.uid]!, ready: true };
    doc.isBotGame = true;
    doc.botDifficulty = difficulty;

    tx.set(gameRef, doc);
    tx.set(refs.gameCode(code), { gameId: gameRef.id, createdAt: now });
    const board: PrivateBoardDoc = { fleet: randomFleet(), hitCells: [], updatedAt: now };
    tx.set(refs.privateBoard(gameRef.id, bot.uid), board);
    return { gameId: gameRef.id };
  });
}
