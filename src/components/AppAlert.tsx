import React, { useEffect, useState, useCallback } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Easing,
  Platform,
} from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import * as Haptics from 'expo-haptics';
import { useAppTheme } from '@/context/ThemeContext';

export type AlertType = 'success' | 'destructive' | 'warning' | 'error' | 'info';

export interface AppAlertButton {
  text: string;
  onPress?: () => void;
  style?: 'default' | 'cancel' | 'destructive';
}

export interface AppAlertOptions {
  type?: AlertType;
  icon?: keyof typeof FontAwesome.glyphMap;
  cancelable?: boolean;
}

interface AlertPayload {
  id: string;
  title: string;
  message?: string;
  buttons?: AppAlertButton[];
  options?: AppAlertOptions;
}

type AlertListener = (payload: AlertPayload | null) => void;

class AlertEventEmitter {
  private listeners: Set<AlertListener> = new Set();
  private currentAlert: AlertPayload | null = null;

  subscribe(listener: AlertListener): () => void {
    this.listeners.add(listener);
    if (this.currentAlert) {
      listener(this.currentAlert);
    }
    return () => {
      this.listeners.delete(listener);
    };
  }

  show(payload: AlertPayload) {
    this.currentAlert = payload;
    this.listeners.forEach((listener) => listener(payload));
  }

  dismiss() {
    this.currentAlert = null;
    this.listeners.forEach((listener) => listener(null));
  }
}

const alertEmitter = new AlertEventEmitter();

/**
 * Global drop-in replacement for React Native's `Alert.alert`.
 * Renders an Apple/Linear-grade glassmorphism dialog with FontAwesome icons.
 */
export function appAlert(
  title: string,
  message?: string,
  buttons?: AppAlertButton[],
  options?: AppAlertOptions
): void {
  const defaultButtons: AppAlertButton[] = buttons && buttons.length > 0 ? buttons : [{ text: 'OK', style: 'default' }];
  alertEmitter.show({
    id: Math.random().toString(36).substring(2, 9),
    title,
    message,
    buttons: defaultButtons,
    options,
  });
}

/**
 * Programmatically dismiss any currently showing AppAlert dialog.
 */
export function dismissAppAlert(): void {
  alertEmitter.dismiss();
}

function resolveAlertType(payload: AlertPayload): {
  type: AlertType;
  icon: keyof typeof FontAwesome.glyphMap;
  color: string;
} {
  if (payload.options?.type) {
    switch (payload.options.type) {
      case 'destructive':
        return {
          type: 'destructive',
          icon: payload.options.icon || 'trash',
          color: '#EF4444',
        };
      case 'success':
        return {
          type: 'success',
          icon: payload.options.icon || 'check',
          color: '#10B981',
        };
      case 'warning':
        return {
          type: 'warning',
          icon: payload.options.icon || 'exclamation-triangle',
          color: '#F59E0B',
        };
      case 'error':
        return {
          type: 'error',
          icon: payload.options.icon || 'times-circle',
          color: '#F43F5E',
        };
      default:
        return {
          type: 'info',
          icon: payload.options.icon || 'info-circle',
          color: '#0284C7',
        };
    }
  }

  const hasDestructiveBtn = payload.buttons?.some((b) => b.style === 'destructive');
  const fullText = `${payload.title} ${payload.message || ''}`.toLowerCase();

  if (hasDestructiveBtn || fullText.includes('delete') || fullText.includes('discard') || fullText.includes('remove') || fullText.includes('clear')) {
    return {
      type: 'destructive',
      icon: payload.options?.icon || 'trash',
      color: '#EF4444',
    };
  }

  if (fullText.includes('success') || fullText.includes('reclaimed') || fullText.includes('restored') || fullText.includes('saved') || fullText.includes('complete ✓') || (fullText.includes('complete') && !fullText.includes('incomplete'))) {
    return {
      type: 'success',
      icon: payload.options?.icon || 'check',
      color: '#10B981',
    };
  }

  if (fullText.includes('incomplete') || fullText.includes('warning') || fullText.includes('permission') || fullText.includes('paused') || fullText.includes('notice') || fullText.includes('caution')) {
    return {
      type: 'warning',
      icon: payload.options?.icon || 'exclamation-triangle',
      color: '#F59E0B',
    };
  }

  if (fullText.includes('failed') || fullText.includes('error') || fullText.includes('cannot') || fullText.includes('unable') || fullText.includes('offline')) {
    return {
      type: 'error',
      icon: payload.options?.icon || 'times-circle',
      color: '#F43F5E',
    };
  }

  return {
    type: 'info',
    icon: payload.options?.icon || 'info-circle',
    color: '#0284C7',
  };
}

/**
 * Root Host component for displaying AppAlerts.
 * Mount this once in the root app navigator (`src/app/_layout.tsx`).
 */
export function AppAlertHost() {
  const { isDark } = useAppTheme();
  const [currentAlert, setCurrentAlert] = useState<AlertPayload | null>(null);

  // Backdrop (scrim) fades independently for a layered feel
  const [backdropAnim] = useState(() => new Animated.Value(0));
  // Card: scale + translateY + opacity — all three for Apple-like spring entry
  const [fadeAnim] = useState(() => new Animated.Value(0));
  const [scaleAnim] = useState(() => new Animated.Value(0.88));
  const [translateYAnim] = useState(() => new Animated.Value(32));
  // Icon pops in with its own spring after the card settles
  const [iconScaleAnim] = useState(() => new Animated.Value(0.6));
  const [iconOpacityAnim] = useState(() => new Animated.Value(0));

  // ─── Entrance ────────────────────────────────────────────────────────────────
  const runEnterAnimation = useCallback(() => {
    // Reset all to initial state
    backdropAnim.setValue(0);
    fadeAnim.setValue(0);
    scaleAnim.setValue(0.88);
    translateYAnim.setValue(32);
    iconScaleAnim.setValue(0.6);
    iconOpacityAnim.setValue(0);

    // Phase 1 — backdrop + card in parallel
    Animated.parallel([
      // Backdrop: smooth linear fade
      Animated.timing(backdropAnim, {
        toValue: 1,
        duration: 220,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      // Card opacity: short fade
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 200,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      // Card scale: spring overshoot (feels "alive")
      Animated.spring(scaleAnim, {
        toValue: 1,
        damping: 16,
        stiffness: 300,
        mass: 0.9,
        useNativeDriver: true,
      }),
      // Card slide-up from slightly below
      Animated.spring(translateYAnim, {
        toValue: 0,
        damping: 18,
        stiffness: 320,
        mass: 0.85,
        useNativeDriver: true,
      }),
    ]).start(() => {
      // Phase 2 — icon badge pops in after card settles
      Animated.parallel([
        Animated.spring(iconScaleAnim, {
          toValue: 1,
          damping: 10,
          stiffness: 400,
          mass: 0.7,
          useNativeDriver: true,
        }),
        Animated.timing(iconOpacityAnim, {
          toValue: 1,
          duration: 100,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start();
    });
  }, [backdropAnim, fadeAnim, scaleAnim, translateYAnim, iconScaleAnim, iconOpacityAnim]);

  // ─── Exit ─────────────────────────────────────────────────────────────────
  const runExitAnimation = useCallback((onDone: () => void) => {
    Animated.parallel([
      // Backdrop fades out cleanly
      Animated.timing(backdropAnim, {
        toValue: 0,
        duration: 180,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
      // Card fades
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 160,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
      // Card shrinks & slides down slightly (feels like gravity pulling it away)
      Animated.timing(scaleAnim, {
        toValue: 0.92,
        duration: 160,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(translateYAnim, {
        toValue: 16,
        duration: 160,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
      // Icon fades out first
      Animated.timing(iconOpacityAnim, {
        toValue: 0,
        duration: 100,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start(() => onDone());
  }, [backdropAnim, fadeAnim, scaleAnim, translateYAnim, iconOpacityAnim]);

  useEffect(() => {
    const unsubscribe = alertEmitter.subscribe((payload) => {
      if (payload) {
        setCurrentAlert(payload);
        // Run enter after state flushes (next frame)
        requestAnimationFrame(() => runEnterAnimation());

        const { type } = resolveAlertType(payload);
        if (type === 'destructive') {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
        } else if (type === 'success') {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        } else if (type === 'warning') {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
        } else if (type === 'error') {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
        } else {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        }
      } else {
        // Dismissed from outside (e.g. dismissAppAlert())
        runExitAnimation(() => setCurrentAlert(null));
      }
    });

    return unsubscribe;
  }, [runEnterAnimation, runExitAnimation]);

  const handleDismiss = useCallback((button?: AppAlertButton) => {
    runExitAnimation(() => {
      setCurrentAlert(null);
      alertEmitter.dismiss();
      if (button?.onPress) {
        button.onPress();
      }
    });
  }, [runExitAnimation]);

  if (!currentAlert) {
    return null;
  }

  const { type, icon, color } = resolveAlertType(currentAlert);

  const cardBg = isDark ? 'rgba(22, 30, 48, 0.94)' : 'rgba(255, 255, 255, 0.97)';
  const cardBorder = isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.08)';
  const textColor = isDark ? '#F8FAFC' : '#0F172A';
  const subtextColor = isDark ? '#94A3B8' : '#64748B';
  const cancelBg = isDark ? 'rgba(51, 65, 85, 0.6)' : '#F1F5F9';
  const cancelBorder = isDark ? 'rgba(255, 255, 255, 0.08)' : '#E2E8F0';
  const cancelText = isDark ? '#CBD5E1' : '#475569';

  const buttons = currentAlert.buttons && currentAlert.buttons.length > 0
    ? currentAlert.buttons
    : [{ text: 'OK', style: 'default' as const }];

  const isDual = buttons.length === 2;

  return (
    <Modal
      transparent
      visible={true}
      animationType="none"
      onRequestClose={() => {
        const cancelBtn = buttons.find((b) => b.style === 'cancel');
        handleDismiss(cancelBtn || buttons[0]);
      }}
    >
      {/* Animated backdrop — fades independently */}
      <Animated.View style={[styles.backdrop, { opacity: backdropAnim }]}>
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          onPress={() => {
            if (currentAlert.options?.cancelable) {
              const cancelBtn = buttons.find((b) => b.style === 'cancel');
              handleDismiss(cancelBtn || buttons[0]);
            }
          }}
        />
        {/* Card: scale + translateY + opacity */}
        <Animated.View
          style={[
            styles.cardContainer,
            {
              backgroundColor: cardBg,
              borderColor: cardBorder,
              opacity: fadeAnim,
              transform: [
                { scale: scaleAnim },
                { translateY: translateYAnim },
              ],
            },
          ]}
        >
          {/* Top Subtle Bevel Specular Highlight */}
          <View style={[styles.specularHighlight, { backgroundColor: isDark ? 'rgba(255, 255, 255, 0.16)' : 'rgba(255, 255, 255, 0.8)' }]} />

          {/* Icon Badge — pops in with its own spring after card */}
          <Animated.View
            style={[
              styles.iconBadge,
              {
                backgroundColor: color + '18',
                borderColor: color + '40',
                opacity: iconOpacityAnim,
                transform: [{ scale: iconScaleAnim }],
              },
            ]}
          >
            <FontAwesome name={icon} size={24} color={color} />
          </Animated.View>

          {/* Title */}
          <Text style={[styles.title, { color: textColor }]} numberOfLines={2}>
            {currentAlert.title}
          </Text>

          {/* Message */}
          {Boolean(currentAlert.message) && (
            <Text style={[styles.message, { color: subtextColor }]}>
              {currentAlert.message}
            </Text>
          )}

          {/* Action Buttons */}
          <View style={isDual ? styles.dualButtonRow : styles.stackedButtonColumn}>
            {buttons.map((btn, idx) => {
              const isDestructive = btn.style === 'destructive' || (type === 'destructive' && idx === buttons.length - 1 && btn.style !== 'cancel');
              const isCancel = btn.style === 'cancel' || (isDual && idx === 0 && btn.style !== 'destructive');

              let btnBg = color;
              let btnTextColor = '#FFFFFF';
              let btnBorderColor = 'transparent';

              if (isCancel) {
                btnBg = cancelBg;
                btnTextColor = cancelText;
                btnBorderColor = cancelBorder;
              } else if (isDestructive) {
                btnBg = '#EF4444';
                btnTextColor = '#FFFFFF';
              } else if (type === 'success') {
                btnBg = '#10B981';
                btnTextColor = '#FFFFFF';
              } else if (type === 'warning') {
                btnBg = '#F59E0B';
                btnTextColor = '#FFFFFF';
              }

              return (
                <TouchableOpacity
                  key={`${btn.text}-${idx}`}
                  style={[
                    styles.buttonBase,
                    isDual && styles.dualButton,
                    {
                      backgroundColor: btnBg,
                      borderColor: btnBorderColor,
                      borderWidth: isCancel ? 1 : 0,
                    },
                  ]}
                  activeOpacity={0.75}
                  onPress={() => handleDismiss(btn)}
                >
                  <Text
                    style={[
                      styles.buttonText,
                      {
                        color: btnTextColor,
                        fontWeight: isCancel ? '600' : '700',
                      },
                    ]}
                    numberOfLines={1}
                  >
                    {btn.text}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(5, 8, 16, 0.72)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  cardContainer: {
    width: '100%',
    maxWidth: 340,
    borderRadius: 24,
    borderWidth: 1,
    paddingTop: 28,
    paddingBottom: 22,
    paddingHorizontal: 22,
    alignItems: 'center',
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 16 },
        shadowOpacity: 0.45,
        shadowRadius: 28,
      },
      android: {
        elevation: 16,
      },
    }),
  },
  specularHighlight: {
    position: 'absolute',
    top: 0,
    left: 20,
    right: 20,
    height: 1,
  },
  iconBadge: {
    width: 58,
    height: 58,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    ...Platform.select({
      ios: {
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.35,
        shadowRadius: 10,
      },
      android: {
        elevation: 4,
      },
    }),
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
    letterSpacing: -0.3,
    marginBottom: 8,
  },
  message: {
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    marginBottom: 22,
    paddingHorizontal: 4,
  },
  dualButtonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    width: '100%',
  },
  stackedButtonColumn: {
    flexDirection: 'column',
    width: '100%',
    gap: 8,
  },
  buttonBase: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dualButton: {
    flex: 1,
  },
  buttonText: {
    fontSize: 14,
  },
});
