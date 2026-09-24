/** Fighter silhouette pointing right (+x). Flip with scaleX(-1) when flying left. */
export function Jet({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg viewBox="0 0 64 24" aria-hidden focusable="false" className={className} style={style} fill="currentColor">
      <path d="M63 12 46 10.5 34 5 28 9.5l-11 .5L9 4l-3.5 1 3.5 4.5L2 11l-2 1 2 1 7 1.5L5.5 19 9 20l8-6 11 .5 6 4.5 12-5.5z" />
    </svg>
  );
}
