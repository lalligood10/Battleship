import { useCallback, useEffect, useState } from 'react';

export type ThemePreference = 'system' | 'light' | 'dark';
const KEY = 'broadside.theme';

function readPreference(): ThemePreference {
  const v = localStorage.getItem(KEY);
  return v === 'light' || v === 'dark' ? v : 'system';
}

function apply(pref: ThemePreference) {
  const root = document.documentElement;
  if (pref === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', pref);
}

export function useTheme(): [ThemePreference, (p: ThemePreference) => void] {
  const [pref, setPref] = useState<ThemePreference>(readPreference);
  useEffect(() => apply(pref), [pref]);
  const update = useCallback((p: ThemePreference) => {
    localStorage.setItem(KEY, p);
    setPref(p);
    apply(p);
  }, []);
  return [pref, update];
}
