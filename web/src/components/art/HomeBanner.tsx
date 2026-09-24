/** Decorative home-screen banner: a ship drifting at sea with an occasional jet flyover. */
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
