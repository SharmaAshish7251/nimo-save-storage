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
import { getConfig, onConfigSaved } from '@/lib/storage/queue';
import { useAppTheme } from '@/context/ThemeContext';

export function BiometricLockOverlay() {
  const { isDark } = useAppTheme();

  const [isLocked, setIsLocked] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const lastBackgroundTime = useRef<number | null>(null);
  const isAuthenticating = useRef<boolean>(false);
  const lastAuthAttemptAt = useRef<number>(0);
  const lastUnlockedAt = useRef<number>(0);

  const triggerAuth = useCallback(async (isManualTap = false) => {
    const now = Date.now();
    // Guard against rapid duplicate prompts, but allow manual user taps to retry
    if (isAuthenticating.current) return;
    if (!isManualTap && now - lastAuthAttemptAt.current < 2000) return;

    isAuthenticating.current = true;
    lastAuthAttemptAt.current = now;
    setAuthError(null);

    try {
      const [securityLevel, isEnrolled] = await Promise.all([
        LocalAuthentication.getEnrolledLevelAsync().catch(
          () => LocalAuthentication.SecurityLevel.NONE
        ),
        LocalAuthentication.isEnrolledAsync().catch(() => false),
      ]);

      const hasSecurity =
        securityLevel !== LocalAuthentication.SecurityLevel.NONE || isEnrolled;

      if (!hasSecurity) {
        // Device has no screen lock (no PIN, pattern, passcode, or biometrics), safely unlock
        setIsLocked(false);
        lastUnlockedAt.current = Date.now();
        return;
      }

      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Unlock Nimo Save Storage',
        fallbackLabel: 'Use Device PIN / Passcode',
        cancelLabel: 'Cancel',
        disableDeviceFallback: false,
      });

      lastAuthAttemptAt.current = Date.now();

      if (result.success) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        lastUnlockedAt.current = Date.now();
        lastBackgroundTime.current = null;
        setIsLocked(false);
        setAuthError(null);
      } else {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
        setAuthError(result.error || 'Authentication required');
      }
    } catch (err: any) {
      setAuthError(err?.message || 'Authentication error');
    } finally {
      // Delay clearing isAuthenticating slightly to ensure the system BiometricPrompt dismiss
      // does not trigger a false AppState background/active re-lock loop
      setTimeout(() => {
        isAuthenticating.current = false;
      }, 600);
    }
  }, []);

  const checkLockState = useCallback(async () => {
    try {
      const appConfig = await getConfig();
      if (appConfig.biometricLockEnabled) {
        setIsLocked(true);
        triggerAuth(false);
      }
    } catch (err) {
      console.warn('[Biometric] Failed to check initial lock state:', err);
    }
  }, [triggerAuth]);

  useEffect(() => {
    checkLockState();

    const unsubConfig = onConfigSaved((newCfg) => {
      if (!newCfg.biometricLockEnabled) {
        setIsLocked(false);
        setAuthError(null);
      }
    });

    const subscription = AppState.addEventListener('change', async (nextState: AppStateStatus) => {
      const currentConfig = await getConfig().catch(() => null);
      if (!currentConfig?.biometricLockEnabled) {
        setIsLocked(false);
        return;
      }

      // CRITICAL: When the system BiometricPrompt dialog opens on Android, Android fires
      // AppState 'inactive'/'background', and when it closes it fires 'active'.
      // If we are currently in the middle of authenticating, DO NOT record background time or re-lock!
      if (isAuthenticating.current) {
        return;
      }

      if (nextState.match(/inactive|background/)) {
        lastBackgroundTime.current = Date.now();
      } else if (nextState === 'active') {
        // If user unlocked within the last 5 seconds, ignore active event to prevent infinite re-lock
        if (Date.now() - lastUnlockedAt.current < 5000) {
          return;
        }

        const timeoutSec = currentConfig.biometricLockTimeout ?? 0;
        const lastBg = lastBackgroundTime.current || 0;
        const elapsedSec = lastBg > 0 ? (Date.now() - lastBg) / 1000 : 0;

        // Only lock if the app was genuinely backgrounded for longer than timeoutSec
        if (lastBg > 0 && (timeoutSec === 0 || elapsedSec >= timeoutSec)) {
          lastBackgroundTime.current = null;
          setIsLocked(true);
          triggerAuth(false);
        }
      }
    });

    return () => {
      subscription.remove();
      unsubConfig();
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
          Protected by Biometric & Device Passcode
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
            triggerAuth(true);
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
    borderRadius: 12,
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
