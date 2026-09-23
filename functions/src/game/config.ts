/**
 * Game configuration. Everything a product owner might want to tweak lives here.
 * Changing a value here changes server-side validation; keep the iOS `GameConfig.swift`
 * in sync for client-side previews (the server is always the source of truth).
 */
export const GAME_CONFIG = {
  /** Board is BOARD_SIZE x BOARD_SIZE. Columns are labelled A–J, rows 1–10. */
  BOARD_SIZE: 10,

  /** Classic rules allow ships to touch side-by-side. Set false to require a one-cell gap. */
  ALLOW_TOUCHING_SHIPS: true,

  /** Private-game join codes: characters chosen to avoid look-alikes (no 0/O, 1/I). */
  JOIN_CODE_LENGTH: 6,
  JOIN_CODE_ALPHABET: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789',

  /** How long a player may be inactive before the opponent can claim the win (ms). Default 3 days. */
  ABANDON_TIMEOUT_MS: 3 * 24 * 60 * 60 * 1000,

  /** Games nobody joined are deleted after this long (ms). Default 7 days. */
  UNJOINED_GAME_TTL_MS: 7 * 24 * 60 * 60 * 1000,

  /** Quick-match tickets older than this are ignored/cleaned (ms). */
  QUICK_MATCH_TICKET_TTL_MS: 10 * 60 * 1000,
} as const;

/** The five classic ship types and their lengths. Order here is the display order. */
export const SHIP_TYPES = ['carrier', 'battleship', 'cruiser', 'submarine', 'destroyer'] as const;
export type ShipType = (typeof SHIP_TYPES)[number];

export const SHIP_LENGTHS: Record<ShipType, number> = {
  carrier: 5,
  battleship: 4,
  cruiser: 3,
  submarine: 3,
  destroyer: 2,
};

export const TOTAL_SHIP_CELLS = SHIP_TYPES.reduce((sum, t) => sum + SHIP_LENGTHS[t], 0);
