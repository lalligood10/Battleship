/** Side-profile warship silhouette; the hull's waterline sits at the bottom edge. */
export function Ship({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg viewBox="0 0 80 22" aria-hidden focusable="false" className={className} style={style} fill="currentColor">
      <path d="M1 14h78l-5 8H8z" />
      <path d="M13 10h36v4H13zM19 6h24v4H19zM29 1h5v5h-5zM37 3h2v3h-2z" />
      <path d="M55 11h10v3H55zM63 9l8 2-8 2zM9 11h9v3H9zM5 11l-4 2 4 1z" />
    </svg>
  );
}
