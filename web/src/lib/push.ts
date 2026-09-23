/**
 * Optional browser push notifications. The in-app "your turn" indicators are the primary
 * notification channel; this only adds OS-level alerts where the browser supports them and the
 * owner has configured a VAPID key (VITE_FIREBASE_VAPID_KEY).
 */
import { arrayRemove, arrayUnion, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { deleteToken, getMessaging, getToken, isSupported } from 'firebase/messaging';
import { db, firebaseApp, useEmulators, vapidKey } from './firebase';

const TOKEN_KEY = 'broadside.pushToken';

export type PushState = 'unavailable' | 'blocked' | 'off' | 'on';

export async function pushAvailable(): Promise<boolean> {
  if (useEmulators || !vapidKey || typeof Notification === 'undefined' || !('serviceWorker' in navigator)) return false;
  return isSupported();
}

export function pushState(): PushState {
  if (typeof Notification === 'undefined') return 'unavailable';
  if (Notification.permission === 'denied') return 'blocked';
  return localStorage.getItem(TOKEN_KEY) ? 'on' : 'off';
}

function pushDoc(uid: string) {
  return doc(db(), 'users', uid, 'private', 'push');
}

export async function enablePush(uid: string): Promise<PushState> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'blocked' : 'off';
  const registration = await navigator.serviceWorker.register('/push-sw.js');
  const token = await getToken(getMessaging(firebaseApp()), { vapidKey, serviceWorkerRegistration: registration });
  await setDoc(pushDoc(uid), { tokens: arrayUnion(token), updatedAt: serverTimestamp() }, { merge: true });
  localStorage.setItem(TOKEN_KEY, token);
  return 'on';
}

export async function disablePush(uid: string): Promise<PushState> {
  const token = localStorage.getItem(TOKEN_KEY);
  localStorage.removeItem(TOKEN_KEY);
  if (token) {
    await setDoc(pushDoc(uid), { tokens: arrayRemove(token), updatedAt: serverTimestamp() }, { merge: true });
    await deleteToken(getMessaging(firebaseApp())).catch(() => undefined);
  }
  return 'off';
}
