import React, { createContext, useContext, useEffect, useState, useMemo, useCallback } from 'react';
import { Appearance, useColorScheme as useRNColorScheme } from 'react-native';
import { getConfig, saveConfig, onConfigSaved } from '@/lib/storage/queue';

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

function applyAppearance(mode: ThemeMode) {
  try {
    Appearance.setColorScheme(mode === 'system' ? 'unspecified' : mode);
  } catch (e) {
    console.warn('[ThemeContext] Appearance.setColorScheme error:', e);
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useRNColorScheme();
  const [deviceScheme, setDeviceScheme] = useState(Appearance.getColorScheme());
  const [themeMode, setThemeModeState] = useState<ThemeMode>('system');

  // Actively listen to device OS theme changes (Android/iOS quick settings, sunset/sunrise)
  useEffect(() => {
    const sub = Appearance.addChangeListener(({ colorScheme }) => {
      setDeviceScheme(colorScheme);
    });
    return () => {
      sub.remove();
    };
  }, []);

  // Load saved theme from config on startup & listen for live changes
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

    const unsubscribe = onConfigSaved((updatedConfig) => {
      if (mounted && updatedConfig.themeMode) {
        setThemeModeState(updatedConfig.themeMode);
        applyAppearance(updatedConfig.themeMode);
      }
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  const setThemeMode = useCallback(async (mode: ThemeMode) => {
    setThemeModeState(mode);
    applyAppearance(mode);
    await saveConfig({ themeMode: mode });
  }, []);

  const resolvedTheme: 'light' | 'dark' = useMemo(() => {
    if (themeMode === 'light') return 'light';
    if (themeMode === 'dark') return 'dark';
    const effectiveSystem = systemScheme || deviceScheme;
    return effectiveSystem === 'dark' ? 'dark' : 'light';
  }, [themeMode, systemScheme, deviceScheme]);

  const isDark = resolvedTheme === 'dark';

  const toggleTheme = useCallback(async () => {
    // If currently dark (via explicit dark or system dark), switch to light.
    // If currently light (via explicit light or system light), switch to dark.
    const nextMode: ThemeMode = isDark ? 'light' : 'dark';
    await setThemeMode(nextMode);
  }, [isDark, setThemeMode]);

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
