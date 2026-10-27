'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

import {
  DEFAULT_MODE,
  DEFAULT_THEME,
  LEGACY_MODE_STORAGE_KEY,
  LEGACY_STORAGE_KEY,
  MODE_STORAGE_KEY,
  STORAGE_KEY,
  getThemeMeta,
  isMode,
  isThemeId,
  type Mode,
  type ThemeId,
} from '@/lib/themes';

interface ThemeContextValue {
  theme: ThemeId;
  setTheme: (next: ThemeId) => void;
  mode: Mode;
  setMode: (next: Mode) => void;
  toggleMode: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);
const ACCENT_PROPERTIES = [
  '--ac',
  '--ac2',
  '--acm',
  '--ac-l',
  '--night',
] as const;

interface StoredTheme {
  id?: unknown;
  dark?: unknown;
}

function readThemeRecord(): StoredTheme {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

function readStoredPreferences(): { theme: ThemeId; mode: Mode } {
  const record = readThemeRecord();

  let theme: ThemeId = DEFAULT_THEME;
  if (isThemeId(record.id)) {
    theme = record.id;
  } else {
    try {
      const legacyTheme = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (isThemeId(legacyTheme)) theme = legacyTheme;
    } catch {
      // Storage can be unavailable in sandboxed/private contexts.
    }
  }

  let mode: Mode = DEFAULT_MODE;
  try {
    const connectMode = localStorage.getItem(MODE_STORAGE_KEY);
    const legacyMode = localStorage.getItem(LEGACY_MODE_STORAGE_KEY);
    if (isMode(connectMode)) {
      mode = connectMode;
    } else if (typeof record.dark === 'boolean') {
      mode = record.dark ? 'dark' : 'light';
    } else if (isMode(legacyMode)) {
      mode = legacyMode;
    }
  } catch {
    if (typeof record.dark === 'boolean') {
      mode = record.dark ? 'dark' : 'light';
    }
  }

  return { theme, mode };
}

function applyPreferences(theme: ThemeId, mode: Mode) {
  const root = document.documentElement;
  root.classList.toggle('dark', mode === 'dark');
  root.dataset.mode = mode;

  if (theme === DEFAULT_THEME) {
    delete root.dataset.accent;
    for (const property of ACCENT_PROPERTIES) {
      root.style.removeProperty(property);
    }
    return;
  }

  const accent = getThemeMeta(theme);
  root.dataset.accent = accent.id;
  root.style.setProperty('--ac', accent.ac);
  root.style.setProperty('--ac2', accent.ac2);
  root.style.setProperty('--acm', accent.acm);
  root.style.setProperty('--ac-l', accent.l);
  root.style.setProperty('--night', accent.night);
}

function persistPreferences(theme: ThemeId, mode: Mode) {
  try {
    localStorage.setItem(MODE_STORAGE_KEY, mode);
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ id: theme, dark: mode === 'dark' })
    );
    // Keep older Chat builds in sync while their keys are phased out.
    localStorage.setItem(LEGACY_STORAGE_KEY, theme);
    localStorage.setItem(LEGACY_MODE_STORAGE_KEY, mode);
  } catch {
    // The in-memory choice still works when storage is unavailable.
  }
}

function readInitialTheme(): ThemeId {
  if (typeof window === 'undefined') return DEFAULT_THEME;
  const fromAttr = document.documentElement.dataset.accent;
  if (isThemeId(fromAttr)) return fromAttr;
  return readStoredPreferences().theme;
}

function readInitialMode(): Mode {
  if (typeof window === 'undefined') return DEFAULT_MODE;
  const fromAttr = document.documentElement.dataset.mode;
  if (isMode(fromAttr)) return fromAttr;
  return document.documentElement.classList.contains('dark')
    ? 'dark'
    : readStoredPreferences().mode;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeId>(readInitialTheme);
  const [mode, setModeState] = useState<Mode>(readInitialMode);

  const setTheme = useCallback(
    (next: ThemeId) => {
      setThemeState(next);
      applyPreferences(next, mode);
      persistPreferences(next, mode);
    },
    [mode]
  );

  const setMode = useCallback(
    (next: Mode) => {
      setModeState(next);
      applyPreferences(theme, next);
      persistPreferences(theme, next);
    },
    [theme]
  );

  const toggleMode = useCallback(() => {
    setMode(mode === 'dark' ? 'light' : 'dark');
  }, [mode, setMode]);

  useEffect(() => {
    // Replays and migrates legacy astra-chat.* preferences if the inline
    // boot script was blocked by a restrictive browser policy.
    applyPreferences(theme, mode);
    persistPreferences(theme, mode);
    // Initial values are intentionally captured once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (
        e.key !== null &&
        ![
          STORAGE_KEY,
          MODE_STORAGE_KEY,
          LEGACY_STORAGE_KEY,
          LEGACY_MODE_STORAGE_KEY,
        ].includes(e.key)
      )
        return;

      const next = readStoredPreferences();
      setThemeState(next.theme);
      setModeState(next.mode);
      applyPreferences(next.theme, next.mode);
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  return (
    <ThemeContext.Provider
      value={{ theme, setTheme, mode, setMode, toggleMode }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    return {
      theme: DEFAULT_THEME,
      setTheme: () => {},
      mode: DEFAULT_MODE,
      setMode: () => {},
      toggleMode: () => {},
    };
  }
  return ctx;
}
