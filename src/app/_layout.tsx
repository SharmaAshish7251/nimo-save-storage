import 'react-native-get-random-values';
import '@/shims/polyfills';
import { DarkTheme, DefaultTheme, ThemeProvider, Stack, router, usePathname } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { pruneOrphanedUploadCache } from '@/lib/tdlib/fileHelper';
import { Text, TouchableOpacity, StyleSheet, View, StatusBar as RNStatusBar, Platform, ActivityIndicator } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';

import { ThemeProvider as AppThemeProvider, useAppTheme } from '@/context/ThemeContext';
import { registerBackgroundUploadTask } from '@/tasks/backgroundUpload';
import { schedulerEngine } from '@/lib/scheduler/schedulerEngine';
import { BiometricLockOverlay } from '@/components/BiometricLockOverlay';
import { AppAlertHost } from '@/components/AppAlert';
import { BottomNavBar } from '@/components/BottomNavBar';
import { recoverInterruptedUploads } from '@/lib/storage/queue';
import { initDatabase } from '@/lib/storage/database';
import { vaultService } from '@/lib/crypto/vault';
import { uploadManager } from '@/lib/upload/manager';
import '@/app/logs'; // Initialize log capture

SplashScreen.preventAutoHideAsync().catch(() => {});

export function ErrorBoundary({ error, retry }: { error: Error; retry: () => void }) {
  return (
    <SafeAreaView style={styles.errorContainer}>
      <Text style={styles.errorTitle}>Application Error</Text>
      <Text style={styles.errorMessage}>{error?.message || 'An unexpected error occurred'}</Text>
      <TouchableOpacity onPress={retry} style={styles.retryButton}>
        <Text style={styles.retryButtonText}>Try Again</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

function RootLayoutNav() {
  const { isDark } = useAppTheme();
  const themeBg = isDark ? '#0F172A' : '#FFFFFF';
  const themeText = isDark ? '#F8FAFC' : '#0F172A';
  const [isUploading, setIsUploading] = useState(false);
  const pathname = usePathname();
  const insets = useSafeAreaInsets();

  useEffect(() => {
    setIsUploading(uploadManager.isActive);
    const unsub = uploadManager.subscribe((event) => {
      if (event.type === 'queue_complete' || event.type === 'paused') {
        setIsUploading(false);
      } else if (event.type === 'status' || event.type === 'resumed') {
        setIsUploading(uploadManager.isActive);
      }
    });
    return unsub;
  }, []);

  const customDarkTheme = {
    ...DarkTheme,
    colors: {
      ...DarkTheme.colors,
      background: '#0F172A',
      card: '#0F172A',
      border: '#1E293B',
      text: '#F8FAFC',
    },
  };

  const customDefaultTheme = {
    ...DefaultTheme,
    colors: {
      ...DefaultTheme.colors,
      background: '#F8FAFC',
      card: '#FFFFFF',
      border: '#E2E8F0',
      text: '#0F172A',
    },
  };

  useEffect(() => {
    if (Platform.OS === 'android') {
      try {
        (RNStatusBar as any).setBackgroundColor?.(themeBg, true);
      } catch {}
    }
  }, [themeBg]);

  return (
    <ThemeProvider value={isDark ? customDarkTheme : customDefaultTheme}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <View style={{ flex: 1, backgroundColor: themeBg }}>
        <Stack
          screenOptions={{
            headerStyle: {
              backgroundColor: themeBg,
            },
            headerTintColor: themeText,
            headerShadowVisible: false,
            contentStyle: {
              backgroundColor: isDark ? '#0F172A' : '#F8FAFC',
            },
          }}
        >
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="telegram-login" options={{ title: 'Connect Telegram' }} />
          <Stack.Screen name="settings" options={{ title: 'Settings' }} />
          <Stack.Screen name="upload" options={{ title: 'Upload Queue' }} />
          <Stack.Screen name="explore" options={{ title: 'Cloud Explorer' }} />
          <Stack.Screen name="logs" options={{ title: 'Logs' }} />
          <Stack.Screen name="onboarding" options={{ headerShown: false }} />
        </Stack>
        {isUploading && pathname !== '/upload' && (
          <View
            style={{
              position: 'absolute',
              bottom: insets.bottom + 95,
              left: 16,
              right: 16,
              backgroundColor: isDark ? '#0F4C81' : '#1D6FAE',
              borderRadius: 12,
              paddingVertical: 10,
              paddingHorizontal: 14,
              flexDirection: 'row',
              alignItems: 'center',
              zIndex: 999,
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 3 },
              shadowOpacity: 0.3,
              shadowRadius: 6,
              elevation: 8,
            }}
          >
            <ActivityIndicator size="small" color="#60A5FA" style={{ marginRight: 8 }} />
            <Text style={{ color: '#E0F2FE', fontSize: 13, fontWeight: '600', flex: 1 }}>
              Upload in progress…
            </Text>
            <TouchableOpacity
              onPress={() => router.push('/upload' as any)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={{ color: '#93C5FD', fontSize: 13, fontWeight: '700' }}>View →</Text>
            </TouchableOpacity>
          </View>
        )}
        <BottomNavBar />
        <BiometricLockOverlay />
        <AppAlertHost />
      </View>
    </ThemeProvider>
  );
}

export default function RootLayout() {
  const [appIsReady, setAppIsReady] = useState(false);

  useEffect(() => {
    async function prepare() {
      try {
        // Initialize high-performance SQLite database & run legacy migration
        await initDatabase().catch((err) => {
          console.warn('Database initialization error:', err);
        });
        // Clean up orphaned temp upload files older than 10 minutes
        await pruneOrphanedUploadCache().catch(() => {});
        await registerBackgroundUploadTask().catch((err) => {
          console.warn('Background task registration error:', err);
        });
        await recoverInterruptedUploads().catch((err) => {
          console.warn('Queue recovery error:', err);
        });
        await vaultService.migrateLegacyKeyStore().catch((err) => {
          console.warn('Vault legacy migration error:', err);
        });
        schedulerEngine.startActiveRunner();
      } catch (err) {
        console.warn('App initialization error:', err);
      } finally {
        setAppIsReady(true);
        // Do not hide splash here: index.tsx or onboarding.tsx will dismiss it when their view is mounted.
        // Safety fallback timer to prevent splash screen hanging indefinitely if a screen crashes:
        setTimeout(() => {
          SplashScreen.hideAsync().catch(() => {});
        }, 4000);
      }
    }

    prepare();

    return () => {
      schedulerEngine.stopActiveRunner();
    };
  }, []);

  if (!appIsReady) {
    return null;
  }

  return (
    <AppThemeProvider>
      <RootLayoutNav />
    </AppThemeProvider>
  );
}

const styles = StyleSheet.create({
  errorContainer: {
    flex: 1,
    backgroundColor: '#121212',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  errorTitle: {
    color: '#ff6b6b',
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  errorMessage: {
    color: '#e0e0e0',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
  },
  retryButton: {
    backgroundColor: '#7C3AED',
    paddingVertical: 12,
    paddingHorizontal: 28,
    borderRadius: 8,
  },
  retryButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
});
