import { getApps, initializeApp } from 'firebase-admin/app';
import {
  getFirestore,
  type CollectionReference,
  type DocumentReference,
  type Firestore,
} from 'firebase-admin/firestore';
import type {
  GameCodeDoc,
  GameDoc,
  OpponentDoc,
  PrivateBoardDoc,
  PushDoc,
  QuickMatchTicketDoc,
  UserDoc,
  UsernameDoc,
  WeeklyWinsDoc,
} from '../types';

if (getApps().length === 0) initializeApp();

export const db: Firestore = getFirestore();

// Typed reference helpers so call sites don't repeat collection names / casts.
const typed = <T>(ref: DocumentReference | CollectionReference) => ref as unknown as T;

export const refs = {
  user: (uid: string) => typed<DocumentReference<UserDoc>>(db.doc(`users/${uid}`)),
  users: () => typed<CollectionReference<UserDoc>>(db.collection('users')),
  push: (uid: string) => typed<DocumentReference<PushDoc>>(db.doc(`users/${uid}/private/push`)),
  opponent: (uid: string, oppUid: string) =>
    typed<DocumentReference<OpponentDoc>>(db.doc(`users/${uid}/opponents/${oppUid}`)),
  username: (lower: string) => typed<DocumentReference<UsernameDoc>>(db.doc(`usernames/${lower}`)),
  game: (gameId: string) => typed<DocumentReference<GameDoc>>(db.doc(`games/${gameId}`)),
  games: () => typed<CollectionReference<GameDoc>>(db.collection('games')),
  privateBoard: (gameId: string, uid: string) =>
    typed<DocumentReference<PrivateBoardDoc>>(db.doc(`games/${gameId}/private/${uid}`)),
  gameCode: (code: string) => typed<DocumentReference<GameCodeDoc>>(db.doc(`gameCodes/${code}`)),
  weeklyWins: (weekId: string, uid: string) =>
    typed<DocumentReference<WeeklyWinsDoc>>(db.doc(`weeklyWins/${weekId}/players/${uid}`)),
  quickMatch: (uid: string) => typed<DocumentReference<QuickMatchTicketDoc>>(db.doc(`quickMatch/${uid}`)),
  quickMatchQueue: () => typed<CollectionReference<QuickMatchTicketDoc>>(db.collection('quickMatch')),
};
