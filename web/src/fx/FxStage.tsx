import type { ReactNode } from 'react';

export function FxStage({ children }: { children: ReactNode }) {
  return <div className="fx-stage">{children}</div>;
}
