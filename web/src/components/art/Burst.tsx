/** Eight-point starburst with an inner circle. */
export function Burst({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden focusable="false" className={className} style={style} fill="currentColor">
      <path d="M12 0l1.8 5.2L18 2l-3 4.4L20.5 8 16 11l4.5 1-5.5 1.4 3.6 4.1-5-2.9L12 24l-1.6-9.4-5 2.9 3.6-4.1L3.5 12 8 11 3.5 8l5.5-1.6L6 2l4.2 3.2z" />
      <circle cx="12" cy="12" r="3.4" />
    </svg>
  );
}
