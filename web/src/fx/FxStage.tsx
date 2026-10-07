import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { FEEL } from '../feel/config';
import type { Side } from '../feel/cues';
import { useFeelCue } from '../feel/FeelProvider';
import { sinkBannerText } from './banner';
import { prefersReducedMotion } from './motion';
import { shakeFor, shakeKeyframes } from './shake';

interface Banner {
  id: string;
  side: Side;
  text: string;
}

/**
 * Page-level FX: board shake and the sink banner. Shake animates the board shells rather than the
 * whole page because a transformed ancestor would re-anchor the fixed-position toast and dialogs.
 * State stays local here so cues never re-render the game view.
 */
export function FxStage({ children }: { children: ReactNode }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const shakes = useRef<Animation[]>([]);
  const bannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [banner, setBanner] = useState<Banner | null>(null);

  useFeelCue((cue) => {
    if (cue.type !== 'impact' && cue.type !== 'sink') return;
    const shake = shakeFor(cue, prefersReducedMotion());
    if (shake) {
      for (const a of shakes.current) a.cancel();
      const shells = stageRef.current?.querySelectorAll<HTMLElement>('.board-shell') ?? [];
      const frames = shakeKeyframes(shake.amplitudePx, `${cue.type}:${cue.shotKey}`);
      shakes.current = Array.from(shells, (el) =>
        typeof el.animate === 'function' ? el.animate(frames, { duration: shake.durationMs, easing: 'ease-out' }) : null,
      ).filter((a): a is Animation => a !== null);
    }
    if (cue.type === 'sink') {
      if (bannerTimer.current !== null) clearTimeout(bannerTimer.current);
      setBanner({ id: cue.shotKey, side: cue.side, text: sinkBannerText(cue.side, cue.sunk.shipId) });
      bannerTimer.current = setTimeout(() => {
        bannerTimer.current = null;
        setBanner(null);
      }, FEEL.fx.bannerMs);
    }
  });

  useEffect(
    () => () => {
      if (bannerTimer.current !== null) clearTimeout(bannerTimer.current);
      for (const a of shakes.current) a.cancel();
    },
    [],
  );

  return (
    <div className="fx-stage" ref={stageRef} style={{ '--fx-banner-ms': `${FEEL.fx.bannerMs}ms` } as CSSProperties}>
      {children}
      {banner?.side === 'own' && <div key={`v-${banner.id}`} className="fx-vignette" aria-hidden />}
      <div className="fx-banner-region" aria-live="polite" aria-atomic="true">
        {banner && (
          <div key={banner.id} className={`fx-banner fx-banner--${banner.side}`}>
            {banner.text}
          </div>
        )}
      </div>
    </div>
  );
}
