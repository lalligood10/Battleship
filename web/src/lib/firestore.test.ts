import type { DocumentData, DocumentSnapshot } from 'firebase/firestore';
import { describe, expect, it } from 'vitest';
import { challengeFromSnapshot } from './firestore';

function snapshot(data: DocumentData): DocumentSnapshot<DocumentData> {
  return { id: 'challenge-1', data: () => data } as unknown as DocumentSnapshot<DocumentData>;
}

describe('challengeFromSnapshot', () => {
  it('defaults mode-less legacy challenges to Classic', () => {
    expect(challengeFromSnapshot(snapshot({ fromUid: 'alice', toUid: 'bob' }))?.mode).toBe('classic');
  });

  it('preserves Salvo mode', () => {
    expect(challengeFromSnapshot(snapshot({ mode: 'salvo' }))?.mode).toBe('salvo');
  });

  it('defaults unsupported persisted modes to Classic', () => {
    expect(challengeFromSnapshot(snapshot({ mode: 'abilities' }))?.mode).toBe('classic');
  });
});
