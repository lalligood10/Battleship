// Phase 5 Session A: per-mode stats (`playerStats/{uid}`) and head-to-head (`headToHead/{pair}`).
import type { GameEndConsumer } from './index';

export const statsConsumer: GameEndConsumer = {
  id: 'stats',
  apply: async () => {},
};

export const headToHeadConsumer: GameEndConsumer = {
  id: 'headToHead',
  apply: async () => {},
};
