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

  it('reads supported Abilities mode', () => {
    expect(challengeFromSnapshot(snapshot({ mode: 'abilities' }))?.mode).toBe('abilities');
  });

  it('defaults a missing turn timer to off and preserves a selected timer', () => {
    expect(challengeFromSnapshot(snapshot({}))?.turnTimerMs).toBeNull();
    expect(challengeFromSnapshot(snapshot({ turnTimerMs: 120_000 }))?.turnTimerMs).toBe(120_000);
  });
});
