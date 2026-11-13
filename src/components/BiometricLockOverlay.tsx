import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  AppState,
  AppStateStatus,
  Image,
} from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import * as Haptics from 'expo-haptics';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { getConfig } from '@/lib/storage/queue';
import { useAppTheme } from '@/context/ThemeContext';

export function BiometricLockOverlay() {
  const { isDark } = useAppTheme();

  const [isLocked, setIsLocked] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const lastBackgroundTime = useRef<number | null>(null);
  const isAuthenticating = useRef<boolean>(false);
  const lastAuthAttemptAt = useRef<number>(0);

  const triggerAuth = useCallback(async () => {
    const now = Date.now();
    // Guard against rapid duplicate prompts within 2 seconds
    if (isAuthenticating.current || now - lastAuthAttemptAt.current < 2000) return;
    isAuthenticating.current = true;
    lastAuthAttemptAt.current = now;
    setAuthError(null);

    try {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();

      if (!hasHardware || !isEnrolled) {
        // Device has no enrolled biometrics/passcode, safely unlock
        setIsLocked(false);
        return;
      }

      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Unlock Nimo Save Storage',
        fallbackLabel: 'Use Device Passcode',
        cancelLabel: 'Cancel',
      });

      lastAuthAttemptAt.current = Date.now();

      if (result.success) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        setIsLocked(false);
      } else {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
        setAuthError(result.error || 'Authentication required');
      }
    } catch (err: any) {
      setAuthError(err?.message || 'Authentication error');
    } finally {
      isAuthenticating.current = false;
    }
  }, []);

  const checkLockState = useCallback(async () => {
    try {
      const appConfig = await getConfig();
      if (appConfig.biometricLockEnabled) {
        setIsLocked(true);
        triggerAuth();
      }
    } catch (err) {
      console.warn('[Biometric] Failed to check initial lock state:', err);
    }
  }, [triggerAuth]);

  useEffect(() => {
    checkLockState();

    const subscription = AppState.addEventListener('change', async (nextState: AppStateStatus) => {
      const currentConfig = await getConfig().catch(() => null);
      if (!currentConfig?.biometricLockEnabled) return;

      if (nextState.match(/inactive|background/)) {
        lastBackgroundTime.current = Date.now();
      } else if (nextState === 'active') {
        const timeoutSec = currentConfig.biometricLockTimeout ?? 0;
        const lastBg = lastBackgroundTime.current || 0;
        const elapsedSec = (Date.now() - lastBg) / 1000;
        const timeSinceLastPrompt = Date.now() - lastAuthAttemptAt.current;

        // Prevent infinite re-prompt loops when biometric dialog dismisses and AppState becomes active
        if ((timeoutSec === 0 || elapsedSec >= timeoutSec) && timeSinceLastPrompt > 2500) {
          setIsLocked(true);
          triggerAuth();
        }
      }
    });

    return () => {
      subscription.remove();
    };
  }, [checkLockState, triggerAuth]);

  if (!isLocked) {
    return null;
  }

  const bg = isDark ? '#0F172A' : '#FFFFFF';
  const textColor = isDark ? '#F8FAFC' : '#0F172A';
  const subtextColor = isDark ? '#94A3B8' : '#64748B';

  return (
    <View style={[styles.overlay, { backgroundColor: bg }]}>
      <View style={styles.contentWrap}>
        <Image
          source={require('@/assets/images/app-logo.png')}
          style={styles.logo}
          resizeMode="contain"
        />

        <View style={styles.lockBadge}>
          <FontAwesome name="lock" size={26} color="#208AEF" />
        </View>

        <Text style={[styles.title, { color: textColor }]}>Nimo Save Storage</Text>
        <Text style={[styles.subtitle, { color: subtextColor }]}>
          Protected by Biometric Security
        </Text>

        {authError ? (
          <View style={styles.errorBox}>
            <FontAwesome name="exclamation-circle" size={14} color="#EF4444" style={{ marginRight: 6 }} />
            <Text style={styles.errorText}>Authentication required to access files</Text>
          </View>
        ) : null}

        <TouchableOpacity
          style={styles.unlockBtn}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
            triggerAuth();
          }}
          activeOpacity={0.8}
        >
          <FontAwesome name="shield" size={16} color="#FFFFFF" style={{ marginRight: 8 }} />
          <Text style={styles.unlockBtnText}>Unlock App</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 999999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contentWrap: {
    alignItems: 'center',
    paddingHorizontal: 32,
    maxWidth: 360,
  },
  logo: {
    width: 80,
    height: 80,
    marginBottom: 24,
  },
  lockBadge: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(32, 138, 239, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 6,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 28,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 20,
  },
  errorText: {
    color: '#EF4444',
    fontSize: 12,
    fontWeight: '600',
  },
  unlockBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#208AEF',
    borderRadius: 12,
    paddingHorizontal: 28,
    paddingVertical: 14,
    width: '100%',
    shadowColor: '#208AEF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  unlockBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
});
