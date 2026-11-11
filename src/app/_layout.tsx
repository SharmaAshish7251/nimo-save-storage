import 'react-native-get-random-values';
import '@/shims/polyfills';
import { DarkTheme, DefaultTheme, ThemeProvider, Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import { useColorScheme, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useEffect } from 'react';

import { registerBackgroundUploadTask } from '@/tasks/backgroundUpload';
import { schedulerEngine } from '@/lib/scheduler/schedulerEngine';
import { BiometricLockOverlay } from '@/components/BiometricLockOverlay';
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

export default function RootLayout() {
  const colorScheme = useColorScheme();

  useEffect(() => {
    async function prepare() {
      try {
        // Clean up orphaned temp upload files from previous sessions
        try {
          const uploadCacheDir = `${LegacyFileSystem.cacheDirectory}tdlib_upload/`;
          const info = await LegacyFileSystem.getInfoAsync(uploadCacheDir);
          if (info.exists) {
            await LegacyFileSystem.deleteAsync(uploadCacheDir, { idempotent: true });
          }
        } catch {}
        await registerBackgroundUploadTask().catch((err) => {
          console.warn('Background task registration error:', err);
        });
        schedulerEngine.startActiveRunner();
      } catch (err) {
        console.warn('App initialization error:', err);
      } finally {
        await SplashScreen.hideAsync().catch(() => {});
      }
    }

    prepare();

    return () => {
      schedulerEngine.stopActiveRunner();
    };
  }, []);

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="telegram-login" options={{ title: 'Connect Telegram' }} />
        <Stack.Screen name="settings" options={{ title: 'Settings' }} />
        <Stack.Screen name="upload" options={{ title: 'Upload Queue' }} />
        <Stack.Screen name="explore" options={{ title: 'Cloud Explorer' }} />
        <Stack.Screen name="logs" options={{ title: 'Logs' }} />
        <Stack.Screen name="onboarding" options={{ headerShown: false }} />
      </Stack>
      <BiometricLockOverlay />
    </ThemeProvider>
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
