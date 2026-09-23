/**
 * Firebase bootstrap. The web config is resolved once at startup (see `loadFirebaseConfig`) from,
 * in order of preference:
 *   1. Vite env vars (web/.env.local locally, or GitHub Actions repository variables when deployed):
 *      VITE_FIREBASE_API_KEY, VITE_FIREBASE_AUTH_DOMAIN, VITE_FIREBASE_PROJECT_ID, VITE_FIREBASE_APP_ID,
 *      VITE_FIREBASE_MESSAGING_SENDER_ID (optional), VITE_FIREBASE_VAPID_KEY (optional, web push)
 *   2. Firebase Hosting's reserved URL `/__/firebase/init.json`, which is served automatically when the
 *      site is deployed to Firebase Hosting — so a Hosting deploy needs no env vars at all.
 * Set VITE_USE_EMULATORS=true to talk to the local Firebase emulators instead of the cloud.
 */
import { initializeApp, type FirebaseApp, type FirebaseOptions } from 'firebase/app';
import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore, type Firestore } from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions, type Functions } from 'firebase/functions';

const env = import.meta.env;

export const useEmulators = env.VITE_USE_EMULATORS === 'true';
export const FUNCTIONS_REGION = 'us-central1';
export const vapidKey = env.VITE_FIREBASE_VAPID_KEY as string | undefined;

const fromEnv: FirebaseOptions = {
  apiKey: env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  appId: env.VITE_FIREBASE_APP_ID as string | undefined,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined,
};

const EMULATOR_CONFIG: FirebaseOptions = {
  apiKey: 'demo-api-key',
  authDomain: 'localhost',
  projectId: fromEnv.projectId ?? 'demo-broadside',
  appId: 'demo-app-id',
};

function isComplete(c: FirebaseOptions | null): c is FirebaseOptions {
  return Boolean(c && c.apiKey && c.projectId && c.appId);
}

let resolved: FirebaseOptions | null = null;

/**
 * Resolve the Firebase web config. Called once from main.tsx before rendering. Returns null when
 * nothing is configured, in which case the app shows the SetupPage instead of crashing.
 */
export async function loadFirebaseConfig(): Promise<FirebaseOptions | null> {
  if (resolved) return resolved;
  if (useEmulators) return (resolved = EMULATOR_CONFIG);
  if (isComplete(fromEnv)) return (resolved = fromEnv);
  try {
    const res = await fetch('/__/firebase/init.json', { cache: 'no-store' });
    if (res.ok) {
      const hosted: unknown = await res.json();
      if (typeof hosted === 'object' && hosted !== null && isComplete(hosted as FirebaseOptions)) {
        return (resolved = hosted as FirebaseOptions);
      }
    }
  } catch {
    // Not on Firebase Hosting (or offline) – fall through to "not configured".
  }
  return null;
}

/** True once `loadFirebaseConfig` found a usable config (or we're on emulators). */
export function isConfigured(): boolean {
  return resolved !== null;
}

let app: FirebaseApp | undefined;
let authInstance: Auth | undefined;
let dbInstance: Firestore | undefined;
let functionsInstance: Functions | undefined;

function ensureApp(): FirebaseApp {
  if (app) return app;
  if (!resolved) throw new Error('Firebase is not configured; call loadFirebaseConfig() first.');
  app = initializeApp(resolved);
  return app;
}

export function auth(): Auth {
  if (!authInstance) {
    authInstance = getAuth(ensureApp());
    if (useEmulators) connectAuthEmulator(authInstance, `http://${location.hostname}:9099`, { disableWarnings: true });
  }
  return authInstance;
}

export function db(): Firestore {
  if (!dbInstance) {
    dbInstance = getFirestore(ensureApp());
    if (useEmulators) connectFirestoreEmulator(dbInstance, location.hostname, 8080);
  }
  return dbInstance;
}

export function functions(): Functions {
  if (!functionsInstance) {
    functionsInstance = getFunctions(ensureApp(), FUNCTIONS_REGION);
    if (useEmulators) connectFunctionsEmulator(functionsInstance, location.hostname, 5001);
  }
  return functionsInstance;
}

export function firebaseApp(): FirebaseApp {
  return ensureApp();
}
