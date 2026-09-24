/**
 * Top-down fighter pointing right (+x). Flip with scaleX(-1) when flying left.
 *
 * Shaded with fixed metal/sunset gradients rather than `currentColor` so the airframe reads as a
 * real aircraft (canopy, intakes, twin tails, wing pylons, afterburners) at both 36px and 15% of a
 * board. Gradient ids are module-constant: duplicate defs across instances resolve to the same
 * paint, which is what we want.
 */
export function Jet({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg
      viewBox="0 0 64 24"
      aria-hidden
      focusable="false"
      className={className}
      style={style}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="jet-skin" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#7d8b9c" />
          <stop offset="0.42" stopColor="#dfe7ef" />
          <stop offset="0.58" stopColor="#c2ccd8" />
          <stop offset="1" stopColor="#5d6775" />
        </linearGradient>
        <linearGradient id="jet-wing" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#6d7a8b" />
          <stop offset="0.5" stopColor="#b9c4d1" />
          <stop offset="1" stopColor="#4f5967" />
        </linearGradient>
        <linearGradient id="jet-canopy" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#46617c" />
          <stop offset="0.4" stopColor="#ffc98a" />
          <stop offset="0.62" stopColor="#c07a34" />
          <stop offset="1" stopColor="#27384b" />
        </linearGradient>
        <radialGradient id="jet-burner" cx="0.85" cy="0.5" r="0.7">
          <stop offset="0" stopColor="#fff2c4" />
          <stop offset="0.45" stopColor="#ffb347" stopOpacity="0.85" />
          <stop offset="1" stopColor="#ff7a18" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* afterburner plume trailing the nozzles */}
      <ellipse cx="3.2" cy="12" rx="4" ry="1.4" fill="url(#jet-burner)" />

      {/* all-moving tailplanes */}
      <path d="M16.5 11.5 8.5 6.6 4.6 7.3l3 4.3Z" fill="url(#jet-wing)" />
      <path d="M16.5 12.5 8.5 17.4 4.6 16.7l3-4.3Z" fill="url(#jet-wing)" />

      {/* canted twin tails */}
      <path d="M20.5 10.9 13.5 5.4l-1.6.5 5.6 5.3Z" fill="#94a1b1" />
      <path d="M20.5 13.1 13.5 18.6l-1.6-.5 5.6-5.3Z" fill="#7b8794" />

      {/* main wings */}
      <path d="M39 11 27.5 2.2l-5 .9L20 11.3Z" fill="url(#jet-wing)" />
      <path d="M39 13 27.5 21.8l-5-.9L20 12.7Z" fill="url(#jet-wing)" />

      {/* leading-edge root extensions blending the wings into the fuselage */}
      <path d="M45 10.9 39 10.3l-6 .5v1.1Z" fill="#aab5c2" />
      <path d="M45 13.1 39 13.7l-6-.5v-1.1Z" fill="#98a3b0" />

      {/* wing pylons + missiles */}
      <rect x="23" y="5.2" width="7.5" height="1.2" rx="0.6" fill="#59636f" />
      <path d="M30.5 5.8h2.2" stroke="#d3dae2" strokeWidth="0.6" strokeLinecap="round" />
      <rect x="23" y="17.6" width="7.5" height="1.2" rx="0.6" fill="#59636f" />
      <path d="M30.5 18.2h2.2" stroke="#d3dae2" strokeWidth="0.6" strokeLinecap="round" />

      {/* fuselage: long slim nose tapering back to the nozzles */}
      <path
        d="M62.5 12c-4.5-1.1-8.6-1.8-12.5-2.1L40 9.6l-18 .1c-3.6.1-5.5.5-5.5 1.1v2.4c0 .6 1.9 1 5.5 1.1l18 .1 10-.3c3.9-.3 8-1 12.5-2.1Z"
        fill="url(#jet-skin)"
      />
      <path d="M62.5 12c-2.1-.5-4.2-.92-6.3-1.24v2.48c2.1-.32 4.2-.74 6.3-1.24Z" fill="#55606d" />

      {/* engine intakes */}
      <rect x="31" y="9.5" width="7" height="1.35" rx="0.5" fill="#3d4754" />
      <rect x="31" y="13.15" width="7" height="1.35" rx="0.5" fill="#353e4a" />

      {/* spine highlight + panel line */}
      <path d="M50 10.75c-9-.6-21-.85-33-.75" stroke="#f4f8fb" strokeWidth="0.4" strokeOpacity="0.65" strokeLinecap="round" />
      <path d="M46 13.6c-9 .3-19 .4-29 .3" stroke="#3b4451" strokeWidth="0.35" strokeOpacity="0.5" strokeLinecap="round" />

      {/* canopy */}
      <path d="M49.6 12c-1-.9-2.3-1.4-3.8-1.4-1.9 0-3.7.3-5.3.8v1.2c1.6.5 3.4.8 5.3.8 1.5 0 2.8-.5 3.8-1.4Z" fill="url(#jet-canopy)" />
      <path d="M47.9 11.3c-.7-.35-1.5-.55-2.4-.55" stroke="#fff4de" strokeWidth="0.38" strokeOpacity="0.9" strokeLinecap="round" />
      <path d="M40.5 10.8v2.4" stroke="#39434f" strokeWidth="0.3" strokeOpacity="0.8" strokeLinecap="round" />

      {/* nozzles */}
      <path d="M5 10.4c-1.4.35-2.2.95-2.2 1.6s.8 1.25 2.2 1.6Z" fill="#2c343e" />
    </svg>
  );
}
