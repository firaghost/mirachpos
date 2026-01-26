
import React, { createContext, useContext, useEffect, useState } from 'react';

type Theme = 'dark' | 'light';
type ThemePreference = Theme | 'system';

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const THEME_PREFERENCE_KEY = 'mirachpos.theme.preference.v1';
const LEGACY_THEME_KEY = 'theme';

const getSystemTheme = (): Theme => {
  if (typeof window === 'undefined') return 'dark';
  try {
    if (window.matchMedia('(prefers-color-scheme: light)').matches) return 'light';
  } catch {
    // ignore
  }
  return 'dark';
};

const applyThemeClass = (theme: Theme) => {
  const root = window.document.documentElement;
  if (theme === 'dark') {
    root.classList.add('dark');
    root.classList.remove('light');
  } else {
    root.classList.remove('dark');
    root.classList.add('light');
  }
};

const getInitialTheme = (): Theme => {
  // Check localStorage first
  if (typeof window !== 'undefined') {
    try {
      const storedPref = localStorage.getItem(THEME_PREFERENCE_KEY);
      if (storedPref === 'light' || storedPref === 'dark') {
        return storedPref;
      }
      if (storedPref === 'system') {
        return getSystemTheme();
      }

      const legacy = localStorage.getItem(LEGACY_THEME_KEY);
      if (legacy === 'light' || legacy === 'dark') {
        return legacy;
      }
    } catch {
      // ignore
    }
    // Check system preference
    return getSystemTheme();
  }
  return 'dark';
};

const getInitialPreference = (): ThemePreference => {
  if (typeof window === 'undefined') return 'dark';
  try {
    const storedPref = localStorage.getItem(THEME_PREFERENCE_KEY);
    if (storedPref === 'light' || storedPref === 'dark' || storedPref === 'system') return storedPref;
    const legacy = localStorage.getItem(LEGACY_THEME_KEY);
    if (legacy === 'light' || legacy === 'dark') return legacy;
  } catch {
    // ignore
  }
  return 'system';
};

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setThemeState] = useState<Theme>(getInitialTheme);
  const [preference, setPreference] = useState<ThemePreference>(getInitialPreference);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const storedPref = localStorage.getItem(THEME_PREFERENCE_KEY);
      if (storedPref) return;
      const legacy = localStorage.getItem(LEGACY_THEME_KEY);
      if (legacy === 'light' || legacy === 'dark') {
        localStorage.setItem(THEME_PREFERENCE_KEY, legacy);
      } else {
        localStorage.setItem(THEME_PREFERENCE_KEY, 'system');
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (preference !== 'system') return;
    if (typeof window === 'undefined') return;

    let mql: MediaQueryList | null = null;
    try {
      mql = window.matchMedia('(prefers-color-scheme: dark)');
    } catch {
      mql = null;
    }
    if (!mql) return;

    const onChange = () => {
      setThemeState(getSystemTheme());
    };

    try {
      if (typeof mql.addEventListener === 'function') mql.addEventListener('change', onChange);
      else if (typeof (mql as any).addListener === 'function') (mql as any).addListener(onChange);
    } catch {
      // ignore
    }

    return () => {
      try {
        if (typeof mql?.removeEventListener === 'function') mql.removeEventListener('change', onChange);
        else if (mql && typeof (mql as any).removeListener === 'function') (mql as any).removeListener(onChange);
      } catch {
        // ignore
      }
    };
  }, [preference]);

  // Apply theme class to document on mount and changes
  useEffect(() => {
    applyThemeClass(theme);
    try {
      if (preference === 'system') {
        localStorage.setItem(THEME_PREFERENCE_KEY, 'system');
        localStorage.removeItem(LEGACY_THEME_KEY);
      } else {
        localStorage.setItem(THEME_PREFERENCE_KEY, preference);
        localStorage.setItem(LEGACY_THEME_KEY, preference);
      }
    } catch {
      // ignore
    }
  }, [theme, preference]);

  const toggleTheme = () => {
    setTheme((theme === 'dark' ? 'light' : 'dark'));
  };

  const setTheme = (newTheme: Theme) => {
    setPreference(newTheme);
    setThemeState(newTheme);
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
