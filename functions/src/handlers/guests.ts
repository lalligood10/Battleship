import { HttpsError } from 'firebase-functions/v2/https';

export async function completeGuestUpgrade(_uid: string): Promise<{ isGuest: boolean }> {
  throw new HttpsError('unimplemented', 'Not built yet');
}
