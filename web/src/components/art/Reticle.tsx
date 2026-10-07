/** Targeting reticle: ring, crosshair ticks and corner brackets (stroke only). */
export function Reticle({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg viewBox="0 0 40 40" aria-hidden focusable="false" className={className} style={style} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <circle cx="20" cy="20" r="11" />
      <path d="M20 4v7M20 29v7M4 20h7M29 20h7" />
      <path d="M3 10V3h7M30 3h7v7M37 30v7h-7M10 37H3v-7" strokeWidth="1.6" opacity="0.8" />
      <circle cx="20" cy="20" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  );
}
