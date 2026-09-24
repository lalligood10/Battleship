/** Small bomb silhouette: teardrop body with a tail fin. */
export function Bomb({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg viewBox="0 0 16 24" aria-hidden focusable="false" className={className} style={style} fill="currentColor">
      <ellipse cx="8" cy="15" rx="6" ry="8" />
      <path d="M5 2h6l-1.5 6h-3z" />
      <path d="M2 5l3-2 1 3zm12 0-3-2-1 3z" />
    </svg>
  );
}
