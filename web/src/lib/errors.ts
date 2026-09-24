/** Converts Firebase errors into plain-English messages so no failure is ever silent or cryptic. */
import { FirebaseError } from 'firebase/app';

export class AppError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AppError';
  }
}

const AUTH_MESSAGES: Record<string, string> = {
  'auth/invalid-email': "That email address doesn't look right.",
  'auth/user-not-found': 'Email or password is incorrect.',
  'auth/wrong-password': 'Email or password is incorrect.',
  'auth/invalid-credential': 'Email or password is incorrect.',
  'auth/email-already-in-use': 'An account with that email already exists. Try signing in.',
  'auth/weak-password': 'Password must be at least 6 characters.',
  'auth/network-request-failed': 'No internet connection.',
  'auth/too-many-requests': 'Too many attempts. Please wait a moment and try again.',
  'auth/popup-closed-by-user': 'Sign-in window was closed before finishing.',
  'auth/cancelled-popup-request': 'Sign-in window was closed before finishing.',
  'auth/popup-blocked': 'Your browser blocked the sign-in window. Allow pop-ups and try again.',
};

const FUNCTIONS_MESSAGES: Record<string, string> = {
  'functions/unauthenticated': 'Please sign in again.',
  'functions/unavailable': "Can't reach the server. Check your connection and try again.",
  'functions/deadline-exceeded': "Can't reach the server. Check your connection and try again.",
  'functions/internal': 'Something went wrong on the server. Please try again.',
  'functions/not-found': 'This feature is not available yet — the server is running an older version.',
};

export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof FirebaseError) {
    const known = AUTH_MESSAGES[err.code] ?? FUNCTIONS_MESSAGES[err.code];
    if (known) return new AppError(known);
    if (err.code === 'permission-denied') return new AppError("You don't have access to that.");
    // HttpsError messages from our own Functions are already human-readable.
    return new AppError(err.message.replace(/^Firebase: /, '').replace(/ \(.*\)\.?$/, ''));
  }
  if (err instanceof Error) return new AppError(err.message);
  return new AppError('Something went wrong. Please try again.');
}

export function errorMessage(err: unknown): string {
  return toAppError(err).message;
}
