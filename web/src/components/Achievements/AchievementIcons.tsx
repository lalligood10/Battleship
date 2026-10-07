/** Decorative glyphs; meaning is always carried by adjacent text. */
export function MedalIcon() {
  return (
    <svg className="ach-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M8 3l2.5 6M16 3l-2.5 6" strokeLinecap="round" />
      <circle cx="12" cy="15" r="6" />
      <path d="M12 12l1 2 2 .3-1.5 1.4.4 2.1-1.9-1-1.9 1 .4-2.1L9 14.3l2-.3z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function LockIcon() {
  return (
    <svg className="ach-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" strokeLinecap="round" />
    </svg>
  );
}
