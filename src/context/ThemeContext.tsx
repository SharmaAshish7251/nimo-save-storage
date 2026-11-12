import React, { createContext, useContext, useEffect, useState, useMemo, useCallback } from 'react';
import { Appearance, useColorScheme as useRNColorScheme } from 'react-native';
import { getConfig, saveConfig } from '@/lib/storage/queue';

export type ThemeMode = 'system' | 'light' | 'dark';

export interface ThemeContextValue {
  themeMode: ThemeMode;
  resolvedTheme: 'light' | 'dark';
  isDark: boolean;
  setThemeMode: (mode: ThemeMode) => Promise<void>;
  toggleTheme: () => Promise<void>;
}

const ThemeContext = createContext<ThemeContextValue>({
  themeMode: 'system',
  resolvedTheme: 'light',
  isDark: false,
  setThemeMode: async () => {},
  toggleTheme: async () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useRNColorScheme();
  const [themeMode, setThemeModeState] = useState<ThemeMode>('system');

  // Load saved theme from config on startup
  useEffect(() => {
    let mounted = true;
    getConfig()
      .then((config) => {
        if (mounted) {
          const savedMode = config?.themeMode || 'system';
          setThemeModeState(savedMode);
          applyAppearance(savedMode);
        }
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  const applyAppearance = (mode: ThemeMode) => {
    try {
      if (mode === 'system') {
        Appearance.setColorScheme(null);
      } else {
        Appearance.setColorScheme(mode);
      }
    } catch (e) {
      console.warn('[ThemeContext] Appearance.setColorScheme error:', e);
    }
  };

  const setThemeMode = useCallback(async (mode: ThemeMode) => {
    setThemeModeState(mode);
    applyAppearance(mode);
    await saveConfig({ themeMode: mode });
  }, []);

  const toggleTheme = useCallback(async () => {
    const nextMode: ThemeMode =
      themeMode === 'light' ? 'dark' : themeMode === 'dark' ? 'system' : 'dark';
    await setThemeMode(nextMode);
  }, [themeMode, setThemeMode]);

  const resolvedTheme: 'light' | 'dark' = useMemo(() => {
    if (themeMode === 'light') return 'light';
    if (themeMode === 'dark') return 'dark';
    return systemScheme === 'dark' ? 'dark' : 'light';
  }, [themeMode, systemScheme]);

  const isDark = resolvedTheme === 'dark';

  const value = useMemo(
    () => ({
      themeMode,
      resolvedTheme,
      isDark,
      setThemeMode,
      toggleTheme,
    }),
    [themeMode, resolvedTheme, isDark, setThemeMode, toggleTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useAppTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
