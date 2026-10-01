/** Read-only Firestore access (listeners + queries). Writes always go through Cloud Functions (api.ts). */
import type { ChatMessage } from './types';
import {
  collection,
  doc,
  documentId,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
  type DocumentData,
  type DocumentSnapshot,
  type Unsubscribe,
} from 'firebase/firestore';
import { weekId } from '@shared/scoring';
import { isReactionId } from '@shared/reactions';
import { db } from './firebase';
import { profileFromData } from '../state/SessionProvider';
import type { Game, Opponent, PrivateBoard, Reaction, UserProfile, WeeklyWins } from './types';

export function gameFromSnapshot(snap: DocumentSnapshot<DocumentData>): Game | null {
  const d = snap.data();
  if (!d) return null;
  return {
    id: snap.id,
    code: String(d.code ?? ''),
    status: d.status as Game['status'],
    hostUid: String(d.hostUid ?? ''),
    playerUids: (d.playerUids as string[] | undefined) ?? [],
    players: (d.players as Game['players'] | undefined) ?? {},
    shots: (d.shots as Game['shots'] | undefined) ?? {},
    currentTurnUid: (d.currentTurnUid as string | null | undefined) ?? null,
    turnNumber: Number(d.turnNumber ?? 0),
    winnerUid: (d.winnerUid as string | null | undefined) ?? null,
    endReason: (d.endReason as Game['endReason'] | undefined) ?? null,
    ratingChanges: (d.ratingChanges as Game['ratingChanges'] | undefined) ?? null,
    revealedFleets: (d.revealedFleets as Game['revealedFleets'] | undefined) ?? null,
    isQuickMatch: Boolean(d.isQuickMatch),
    isBotGame: d.isBotGame === true,
    botDifficulty: (d.botDifficulty as Game['botDifficulty'] | undefined) ?? null,
    rematch: (d.rematch as Game['rematch'] | undefined) ?? null,
    rematchOf: (d.rematchOf as string | null | undefined) ?? null,
    invitedUid: (d.invitedUid as string | null | undefined) ?? null,
    abandonTimeoutMs: Number(d.abandonTimeoutMs ?? 0),
    createdAt: (d.createdAt as Game['createdAt'] | undefined) ?? null,
    updatedAt: (d.updatedAt as Game['updatedAt'] | undefined) ?? null,
    startedAt: (d.startedAt as Game['startedAt'] | undefined) ?? null,
    finishedAt: (d.finishedAt as Game['finishedAt'] | undefined) ?? null,
    lastMoveAt: (d.lastMoveAt as Game['lastMoveAt'] | undefined) ?? null,
  };
}

export function listenGame(gameId: string, onData: (g: Game | null) => void, onError: (e: unknown) => void): Unsubscribe {
  return onSnapshot(doc(db(), 'games', gameId), (snap) => onData(gameFromSnapshot(snap)), onError);
}

/** My own hidden board only – security rules reject reading the opponent's. */
export function listenPrivateBoard(
  gameId: string,
  uid: string,
  onData: (b: PrivateBoard | null) => void,
  onError: (e: unknown) => void,
): Unsubscribe {
  return onSnapshot(
    doc(db(), 'games', gameId, 'private', uid),
    (snap) => {
      const d = snap.data();
      onData(
        d
          ? {
              fleet: (d.fleet as PrivateBoard['fleet'] | undefined) ?? [],
              hitCells: (d.hitCells as string[] | undefined) ?? [],
            }
          : null,
      );
    },
    onError,
  );
}

export function listenReactions(gameId: string, onData: (r: Reaction[]) => void, onError: (e: unknown) => void): Unsubscribe {
  const q = query(collection(db(), 'games', gameId, 'reactions'), orderBy('at', 'desc'), limit(20));
  return onSnapshot(
    q,
    (snap) =>
      onData(
        snap.docs
          .map((d) => {
            const data = d.data();
            return {
              id: d.id,
              uid: String(data.uid ?? ''),
              reactionId: data.reactionId,
              at: (data.at as Reaction['at'] | undefined) ?? null,
            };
          })
          .filter((reaction): reaction is Reaction => isReactionId(reaction.reactionId)),
      ),
    onError,
  );
}

export function listenChatMessages(
  gameId: string,
  onData: (messages: ChatMessage[]) => void,
  onError: (e: unknown) => void,
): Unsubscribe {
  const q = query(collection(db(), 'games', gameId, 'messages'), orderBy('at', 'desc'), limit(100));
  return onSnapshot(
    q,
    (snap) =>
      onData(
        snap.docs
          .map((message) => {
            const data = message.data();
            return {
              id: message.id,
              uid: String(data.uid ?? ''),
              username: String(data.username ?? ''),
              text: String(data.text ?? ''),
              at: (data.at as ChatMessage['at'] | undefined) ?? null,
            };
          })
          .reverse(),
      ),
    onError,
  );
}

export function listenActiveGames(uid: string, onData: (games: Game[]) => void, onError: (e: unknown) => void): Unsubscribe {
  const q = query(
    collection(db(), 'games'),
    where('playerUids', 'array-contains', uid),
    where('status', 'in', ['waiting', 'placing', 'active']),
    orderBy('updatedAt', 'desc'),
    limit(50),
  );
  return onSnapshot(
    q,
    (snap) => onData(snap.docs.map(gameFromSnapshot).filter((g): g is Game => g !== null)),
    onError,
  );
}

export async function fetchHistory(uid: string, max = 50): Promise<Game[]> {
  const q = query(
    collection(db(), 'games'),
    where('playerUids', 'array-contains', uid),
    where('status', '==', 'finished'),
    orderBy('finishedAt', 'desc'),
    limit(max),
  );
  const snap = await getDocs(q);
  return snap.docs.map(gameFromSnapshot).filter((g): g is Game => g !== null);
}

export async function fetchGlobalLeaderboard(max = 100): Promise<UserProfile[]> {
  const q = query(collection(db(), 'users'), orderBy('rating', 'desc'), orderBy('stats.wins', 'desc'), limit(max + 100));
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => profileFromData(d.id, d.data()))
    .filter((p) => p.isBot !== true && p.leaderboardVisible && !p.suspended)
    .slice(0, max);
}

export async function fetchWeeklyLeaderboard(max = 100): Promise<WeeklyWins[]> {
  const q = query(
    collection(db(), 'weeklyWins', weekId(new Date()), 'players'),
    orderBy('wins', 'desc'),
    orderBy('rating', 'desc'),
    limit(max + 100),
  );
  const snap = await getDocs(q);
  const rows = snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      username: String(data.username ?? ''),
      wins: Number(data.wins ?? 0),
      rating: Number(data.rating ?? 0),
    };
  });
  const visible = new Set<string>();
  for (let i = 0; i < rows.length; i += 10) {
    const ids = rows.slice(i, i + 10).map((row) => row.id);
    const profiles = await getDocs(query(collection(db(), 'users'), where(documentId(), 'in', ids)));
    for (const profile of profiles.docs) {
      const data = profileFromData(profile.id, profile.data());
      if (data.leaderboardVisible && !data.suspended && data.isBot !== true) visible.add(profile.id);
    }
  }
  return rows.filter((row) => visible.has(row.id)).slice(0, max);
}

/** Friends = everyone I've played (users/{uid}/opponents) plus me, with fresh ratings. */
export async function fetchFriendsLeaderboard(uid: string): Promise<UserProfile[]> {
  const opp = await getDocs(query(collection(db(), 'users', uid, 'opponents'), orderBy('lastPlayedAt', 'desc'), limit(50)));
  const ids = [uid, ...opp.docs.map((d) => d.id)];
  const profiles: UserProfile[] = [];
  for (let i = 0; i < ids.length; i += 10) {
    const chunk = ids.slice(i, i + 10);
    const snap = await getDocs(query(collection(db(), 'users'), where(documentId(), 'in', chunk)));
    profiles.push(...snap.docs.map((d) => profileFromData(d.id, d.data())));
  }
  profiles.sort((a, b) => b.rating - a.rating || b.stats.wins - a.stats.wins);
  return profiles.filter((profile) => profile.leaderboardVisible && !profile.suspended && profile.isBot !== true);
}

export async function fetchOpponents(uid: string): Promise<Opponent[]> {
  const snap = await getDocs(query(collection(db(), 'users', uid, 'opponents'), orderBy('lastPlayedAt', 'desc'), limit(50)));
  return snap.docs.map((d) => ({
    id: d.id,
    username: String(d.data().username ?? ''),
    gamesPlayed: Number(d.data().gamesPlayed ?? 0),
  }));
}
