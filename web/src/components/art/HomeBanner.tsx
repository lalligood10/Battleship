/** Decorative home-screen banner: a console screen with a radar sweep, a ship at sea and an occasional jet. */
import { useEffect, useRef } from 'react';
import { Jet } from './Jet';
import { Ship } from './Ship';

export function HomeBanner() {
  const ref = useRef<HTMLDivElement>(null);

  // Pause the animation while the tab is hidden.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onVisibility = () => el.classList.toggle('fx-paused', document.hidden);
    onVisibility();
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  return (
    <div className="hero-banner" ref={ref} aria-hidden>
      <div className="hero-grid" />
      <div className="hero-copy">
        <span className="hero-brand">Broadside</span>
        <span className="hero-sub">Fleet command · all stations ready</span>
      </div>
      <div className="hero-radar">
        <span className="hero-sweep" />
        <span className="hero-blip" />
      </div>
      <div className="fx">
        <div className="hero-horizon" />
        <div className="hero-ship">
          <div className="hero-bob">
            <Ship />
          </div>
        </div>
        <div className="hero-jet">
          <Jet />
        </div>
      </div>
    </div>
  );
}
