import type { Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';

export async function claimTurnTimeout(
  _uid: string,
  _data: unknown,
): Promise<{ skipped: boolean; forfeited: boolean }> {
  throw new HttpsError('unimplemented', 'Not built yet');
}

export async function sweepTurnTimeouts(_now?: Timestamp): Promise<number> {
  return 0;
}
