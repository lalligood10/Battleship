// Runs before every emulator test file. Points the Admin SDK at the local Firestore emulator.
process.env.GCLOUD_PROJECT ??= 'broadside-dev';
process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099';

export const PROJECT_ID = process.env.GCLOUD_PROJECT;
export const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST;

/** Wipes the emulator's Firestore between tests. */
export async function clearFirestore(): Promise<void> {
  const res = await fetch(`http://${FIRESTORE_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error(`Failed to clear emulator: ${res.status}`);
}
