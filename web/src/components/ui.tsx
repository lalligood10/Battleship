import { useEffect, useRef, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="row" style={{ justifyContent: 'center', padding: 24 }} role="status">
      <span className="spinner" />
      {label && <span className="muted">{label}</span>}
    </div>
  );
}

export function Alert({
  kind = 'error',
  children,
  onDismiss,
}: {
  kind?: 'error' | 'info' | 'success';
  children: ReactNode;
  onDismiss?: () => void;
}) {
  return (
    <div className={`alert alert--${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <span>{children}</span>
      {onDismiss && (
        <button type="button" onClick={onDismiss} aria-label="Dismiss">
          ✕
        </button>
      )}
    </div>
  );
}

export function Empty({ title, message, children }: { title: string; message?: string; children?: ReactNode }) {
  return (
    <div className="empty card">
      <h3>{title}</h3>
      {message && <p>{message}</p>}
      {children && <div style={{ marginTop: 12 }}>{children}</div>}
    </div>
  );
}

export function Toast({ message, onDone, ms = 2200 }: { message: string | null; onDone: () => void; ms?: number }) {
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(onDone, ms);
    return () => clearTimeout(t);
  }, [message, ms, onDone]);
  if (!message) return null;
  return <div className="toast">{message}</div>;
}

export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = dialogRef.current?.querySelector<HTMLElement>('button, input, [href], [tabindex]');
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previouslyFocused?.focus();
    };
  }, []);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ fontSize: 20 }}>{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function TopBar({ title, back, right }: { title: string; back?: string | true; right?: ReactNode }) {
  const navigate = useNavigate();
  return (
    <header className="topbar">
      {back && (
        <button
          type="button"
          className="btn btn--ghost btn--icon back"
          aria-label="Back"
          onClick={() => (back === true ? navigate(-1) : navigate(back))}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M15 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
      <h1>{title}</h1>
      {right}
    </header>
  );
}

export type IconName = 'play' | 'trophy' | 'person' | 'wave' | 'sound' | 'muted';

export function Icon({ name }: { name: IconName }) {
  switch (name) {
    case 'wave':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M2 12c2 0 3-2 5-2s3 2 5 2 3-2 5-2 3 2 5 2M2 17c2 0 3-2 5-2s3 2 5 2 3-2 5-2 3 2 5 2M2 7c2 0 3-2 5-2s3 2 5 2 3-2 5-2 3 2 5 2" />
        </svg>
      );
    case 'sound':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M4 9v6h4l5 4V5L8 9H4z" />
          <path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11" />
        </svg>
      );
    case 'muted':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M4 9v6h4l5 4V5L8 9H4z" />
          <path d="M16 9l5 6M21 9l-5 6" />
        </svg>
      );
    case 'play':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="3" />
          <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
        </svg>
      );
    case 'trophy':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M8 4h8v5a4 4 0 0 1-8 0V4z" />
          <path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8 21h8M10 17h4" />
        </svg>
      );
    case 'person':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21a8 8 0 0 1 16 0" />
        </svg>
      );
  }
}

export function TabBar({ attention }: { attention?: number }) {
  const path = useLocation().pathname;
  const tab = (to: string, label: string, icon: 'play' | 'trophy' | 'person', badge?: number) => (
    <Link to={to} className={path === to || (to !== '/' && path.startsWith(to)) ? 'active' : ''}>
      <span style={{ position: 'relative' }}>
        <Icon name={icon} />
        {badge ? (
          <span
            className="badge badge--turn"
            style={{ position: 'absolute', top: -6, right: -14, padding: '1px 6px', fontSize: 10 }}
          >
            {badge}
          </span>
        ) : null}
      </span>
      {label}
    </Link>
  );
  return (
    <nav className="tabbar" aria-label="Main">
      {tab('/', 'Play', 'play', attention)}
      {tab('/leaderboards', 'Leaderboards', 'trophy')}
      {tab('/profile', 'Profile', 'person')}
    </nav>
  );
}
