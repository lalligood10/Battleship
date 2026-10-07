// Phase 5 Session A: per-mode stats (`playerStats/{uid}`) and head-to-head (`headToHead/{pair}`).
import type { DocumentReference } from 'firebase-admin/firestore';
import { RETENTION_PATHS, type HeadToHeadDoc, type PlayerStatsDoc } from '../../game/analytics/contract';
import { applyRecordToHeadToHead, applyRecordToPlayerStats } from '../../game/analytics/stats';
import { db } from '../../lib/firestore';
import type { GameEndConsumer } from './index';

export const statsConsumer: GameEndConsumer = {
  id: 'stats',
  apply: async (tx, record, _game, nowMs) => {
    const humans = record.lines.filter((line) => !line.isBot);
    if (humans.length === 0) return;
    const refs = humans.map((line) => db.doc(RETENTION_PATHS.playerStats(line.uid)) as DocumentReference<PlayerStatsDoc>);
    const snaps = await tx.getAll(...refs);
    humans.forEach((line, i) => {
      tx.set(refs[i]!, applyRecordToPlayerStats(snaps[i]!.data(), line, record, nowMs));
    });
  },
};

export const headToHeadConsumer: GameEndConsumer = {
  id: 'headToHead',
  apply: async (tx, record) => {
    if (record.isBotGame || record.lines.some((line) => line.isBot)) return;
    const [a, b] = record.playerUids;
    const ref = db.doc(RETENTION_PATHS.headToHead(a, b)) as DocumentReference<HeadToHeadDoc>;
    const snap = await tx.get(ref);
    tx.set(ref, applyRecordToHeadToHead(snap.data(), record));
  },
};
