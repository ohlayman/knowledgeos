import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';

interface ThemeContextValue {
  mode: ThemeMode;
  resolved: 'light' | 'dark';
  setMode: (mode: ThemeMode) => void;
  cycleMode: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);
const STORAGE_KEY = 'kos-theme';

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
    : false;
}

function applyTheme(mode: ThemeMode): 'light' | 'dark' {
  const resolved = mode === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : mode;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.themeMode = mode;
  return resolved;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(() => {
    const saved = typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY);
    return saved === 'light' || saved === 'dark' || saved === 'system' ? saved : 'system';
  });
  const [resolved, setResolved] = useState<'light' | 'dark'>(() => applyTheme(mode));

  useEffect(() => {
    setResolved(applyTheme(mode));
    localStorage.setItem(STORAGE_KEY, mode);
  }, [mode]);

  useEffect(() => {
    if (mode !== 'system' || !window.matchMedia) {
      return;
    }
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const listener = () => setResolved(applyTheme('system'));
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, [mode]);

  const setMode = useCallback((next: ThemeMode) => setModeState(next), []);
  const cycleMode = useCallback(
    () =>
      setModeState((current) =>
        current === 'light' ? 'dark' : current === 'dark' ? 'system' : 'light',
      ),
    [],
  );
  const value = useMemo(
    () => ({ mode, resolved, setMode, cycleMode }),
    [mode, resolved, setMode, cycleMode],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) {
    throw new Error('useTheme must be used inside ThemeProvider');
  }
  return value;
}
