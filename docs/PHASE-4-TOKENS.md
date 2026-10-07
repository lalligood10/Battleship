# Phase 4 design tokens: Naval Command

Art direction (chosen by Luke): **naval command**. A dark navy console with radar green and amber, stencil display type, and a crisp grid. The board is a console screen. It's dark in both themes, so markers look the same everywhere. The Auto/Light/Dark toggle stays: dark is the "night console", and light is the "day console" (light panels around the same dark board).

Tokens live in `web/src/styles/tokens.css`. That file is the contract: child sessions only consume tokens, and any new token or value change goes through the lead.

## Palette

Existing token names stay, so current CSS keeps working. New tokens are marked "new".

| Token | Dark (default) | Light |
|---|---|---|
| `--bg` | `#07131F` | `#E8EEF3` |
| `--card` | `#0B2545` | `#FFFFFF` |
| `--card-2` | `#10305A` | `#F1F5F8` |
| `--text` | `#E6F1EA` | `#0B2545` |
| `--muted` | `#9DB2C7` | `#4A5F75` |
| `--border` | `#2A5480` | `#8FA6BC` |
| `--accent` (text, focus, active state) | `#3DDC97` | `#0B6E4F` |
| `--accent-fill` (new; primary button fill) | `#3DDC97` | `#0B6E4F` |
| `--accent-text` (text on accent fill) | `#04150D` | `#FFFFFF` |
| `--amber` (new) | `#FFB547` | `#8A5300` |
| `--danger` (text) | `#FF7A6B` | `#B3261E` |
| `--danger-fill` (new) | `#FF7A6B` | `#B3261E` |
| `--on-danger` (new) | `#1A0503` | `#FFFFFF` |
| `--success` | `#3DDC97` | `#0B6E4F` |
| `--warning` | `#FFB547` | `#8A5300` |

Every text pair is at least 5.1:1 on `--bg`, `--card` and `--card-2` (calculated). Button fills are 6.2:1 or better against their own label colour.

## Sea and markers (same in both themes)

| Token | Value | Use |
|---|---|---|
| `--sea` / `--sea-2` | `#0A2238` / `#0E2C48` | Board water and frame; replaces `--water` / `--water-2` (keep those as aliases) |
| `--grid-line` | `#1F4A6E` | Cell borders |
| `--sea-label` | `#C9D6E5` | Coordinate labels (10.9:1) |
| `--radar` | `#3DDC97` | Reticle, selected and queued cells, last-shot ring |
| `--ship` | `#5E7C99` | Own ships (3.7:1 vs sea) |
| `--mark-miss` | `#9DB2C7` | Miss: **hollow ring**, 2px stroke, about 36% of cell |
| `--mark-hit-fill` / `--mark-hit-glyph` | `#FFB547` / `#07131F` | Hit: **amber cell with a dark ✕** |
| `--mark-sunk-fill` / `--mark-sunk-glyph` | `#B3261E` / `#FFE1DC` | Sunk: **dark-red cell, light ✕, 45° hatch** |
| `--ship-invalid` | `#FF5A4E` | Invalid placement: red outline (2px) plus diagonal hatch, so it's never colour alone |
| `--focus-ring` / `--focus-ring-inner` | `#FFFFFF` / `#07131F` | Two-tone cell focus ring: 3px outline plus 2px inset |

The three marks differ by shape (ring, ✕ on a solid cell, ✕ with hatch) and by luminance, so they stay distinct in grayscale and colourblind views. Draw glyphs with CSS gradients or pseudo-elements, not emoji.

## Type

- `--font-display`: `'Saira Stencil One', Impact, sans-serif`. Self-hosted through `@fontsource/saira-stencil-one` (OFL). Used **only** for the brand, page titles, the result hero, the sink banner and mode names; never for body text or buttons.
- `--font`: the existing system sans, unchanged.
- `--mono`: `'IBM Plex Mono', ui-monospace, monospace`. Self-hosted through `@fontsource/ibm-plex-mono` (400 and 600). Used for coordinates, codes, timers and stat numbers.
- Scale:
  - `--fs-xs` 12px, `--fs-sm` 14px, `--fs-md` 16px, `--fs-lg` 20px, `--fs-xl` 28px, `--fs-2xl` 40px.
  - `--tracking-label` 0.08em: uppercase labels and button text.

## Space, shape, motion, layers, sizing

- Space: `--space-1` 4px through `--space-7`, in the steps 4, 8, 12, 16, 24, 32 and 48px.
- Radii: `--radius-sm` 4px; `--radius` 8px (was 14px; a crisper console); `--radius-pill` 999px.
- `--glow`: `0 0 0 1px var(--accent), 0 0 12px rgb(61 220 151 / 0.35)`, for active panels and the selected mode.
- Motion:
  - `--dur-fast` 120ms, `--dur-med` 200ms, `--dur-slow` 360ms.
  - `--ease-out`: `cubic-bezier(.2,.8,.2,1)`.
  - The JS `FEEL` config is unchanged.
- Layers: `--z-board-fx` 5, `--z-chat-toggle` 20, `--z-tabbar` 25, `--z-modal` 30, `--z-toast` 40, `--z-banner` 45. The chat toggle now sits below dialogs (audit R9).
- `--tap-min`: 44px. Every interactive control is at least this. Exception: board cells, which are about 32px at 375px because a 10×10 grid can't fit 44px cells. Aim-then-Fire confirmation mitigates mis-taps.

## Shared primitives (lead-owned)

- **Buttons** (`.btn`):
  - Minimum height `--tap-min`, `--radius-sm`, 1px border, uppercase label with `--tracking-label`.
  - Variants: primary (accent fill), secondary (`--card-2` and border), danger (danger fill), ghost (accent text).
  - `--sm` keeps the 44px height and uses less padding. `--icon` is 44×44.
- **Focus**: `:focus-visible` on `.btn`, `a`, `[role=tab]`, `.input` and `.game-mode-option` shows a 2px `--accent` outline with a 2px offset.
- **Panels**: `.card` is a console panel (card bg, 1px border, `--radius`, a faint top highlight). `.panel-title` is a stencil-free uppercase label in `--muted` with `--tracking-label`.
- **Inputs**: 44px minimum height, `--muted` border (R17).
- **Alerts and badges**: use the text tokens above (R5 and R6).
- **Cell markers and board frame**: as in the sea table above (R8 and R13).
- **Modal**: has its own translateY-only entry keyframe (R10).
