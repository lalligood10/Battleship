/** Two concentric splash rings (stroke only). */
export function Splash({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden focusable="false" className={className} style={style} fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="5.5" />
    </svg>
  );
}
