import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { prefs } from './storage.js';

const KEY = 'basera_theme';
const ThemeContext = createContext(null);

function apply(theme) {
  try {
    const root = document.documentElement;
    if (theme === 'light' || theme === 'dark') root.setAttribute('data-theme', theme);
    else root.removeAttribute('data-theme');
  } catch {
    /* no document */
  }
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => prefs.get(KEY, 'system') || 'system');
  useEffect(() => apply(theme), [theme]);
  const setTheme = useCallback((next) => {
    prefs.set(KEY, next);
    setThemeState(next);
  }, []);
  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}

/** Resolved theme right now (for the native status bar). */
export function resolvedTheme(theme) {
  if (theme === 'light' || theme === 'dark') return theme;
  try {
    return globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}
