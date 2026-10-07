// Phase 5 Session B: one-time achievement unlocks (`users/{uid}/achievements/{id}`).
import type { GameEndConsumer } from './index';

export const achievementsConsumer: GameEndConsumer = {
  id: 'achievements',
  apply: async () => {},
};
