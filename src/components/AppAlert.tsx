import React, { useEffect, useState, useCallback } from 'react';
import {
  Modal,
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

interface AnimatedAlertButtonProps {
  button: AppAlertButton;
  index: number;
  isDual: boolean;
  type: AlertType;
  color: string;
  cancelBg: string;
  cancelBorder: string;
  cancelText: string;
  totalButtons: number;
  onPress: () => void;
}

function AnimatedAlertButton({
  button,
  index,
  isDual,
  type,
  color,
  cancelBg,
  cancelBorder,
  cancelText,
  totalButtons,
  onPress,
}: AnimatedAlertButtonProps) {
  const [pressScale] = useState(() => new Animated.Value(1));

  const isDestructive =
    button.style === 'destructive' ||
    (type === 'destructive' && index === totalButtons - 1 && button.style !== 'cancel');
  const isCancel =
    button.style === 'cancel' ||
    (isDual && index === 0 && button.style !== 'destructive');

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

  const handlePressIn = () => {
    Animated.spring(pressScale, {
      toValue: 0.95,
      speed: 50,
      bounciness: 0,
      useNativeDriver: true,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(pressScale, {
      toValue: 1,
      speed: 40,
      bounciness: 6,
      useNativeDriver: true,
    }).start();
  };

  return (
    <Animated.View
      style={[
        isDual ? styles.dualButton : styles.stackedButton,
        {
          transform: [{ scale: pressScale }],
        },
      ]}
    >
      <TouchableOpacity
        activeOpacity={0.88}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        onPress={onPress}
        style={[
          styles.buttonBase,
          {
            backgroundColor: btnBg,
            borderColor: btnBorderColor,
            borderWidth: isCancel ? 1 : 0,
          },
        ]}
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
          {button.text}
        </Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

/**
 * Root Host component for displaying AppAlerts.
 * Mount this once in the root app navigator (`src/app/_layout.tsx`).
 */
export function AppAlertHost() {
  const { isDark } = useAppTheme();
  const [currentAlert, setCurrentAlert] = useState<AlertPayload | null>(null);

  // Motion states for multi-layer cascade
  const [backdropAnim] = useState(() => new Animated.Value(0));
  const [cardFadeAnim] = useState(() => new Animated.Value(0));
  const [cardScaleAnim] = useState(() => new Animated.Value(0.90));
  const [cardTranslateYAnim] = useState(() => new Animated.Value(24));

  const [iconScaleAnim] = useState(() => new Animated.Value(0.4));
  const [iconRotateAnim] = useState(() => new Animated.Value(0));

  const [contentFadeAnim] = useState(() => new Animated.Value(0));
  const [contentTranslateYAnim] = useState(() => new Animated.Value(10));

  const [buttonsFadeAnim] = useState(() => new Animated.Value(0));
  const [buttonsTranslateYAnim] = useState(() => new Animated.Value(12));

  const [specularWidthAnim] = useState(() => new Animated.Value(0.3));

  // ─── Entrance Motion Choreography ──────────────────────────────────────────
  const runEnterAnimation = useCallback((alertType: AlertType) => {
    // Reset all motion values to start positions
    backdropAnim.setValue(0);
    cardFadeAnim.setValue(0);
    cardScaleAnim.setValue(0.90);
    cardTranslateYAnim.setValue(24);

    iconScaleAnim.setValue(0.4);
    iconRotateAnim.setValue(0);

    contentFadeAnim.setValue(0);
    contentTranslateYAnim.setValue(10);

    buttonsFadeAnim.setValue(0);
    buttonsTranslateYAnim.setValue(12);

    specularWidthAnim.setValue(0.3);

    // Parallel multi-layer cascade
    Animated.parallel([
      // 1. Scrim fade
      Animated.timing(backdropAnim, {
        toValue: 1,
        duration: 220,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),

      // 2. Card spring-up & opacity
      Animated.timing(cardFadeAnim, {
        toValue: 1,
        duration: 180,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.spring(cardScaleAnim, {
        toValue: 1,
        damping: 17,
        stiffness: 280,
        mass: 0.85,
        useNativeDriver: true,
      }),
      Animated.spring(cardTranslateYAnim, {
        toValue: 0,
        damping: 19,
        stiffness: 300,
        mass: 0.85,
        useNativeDriver: true,
      }),

      // 3. Specular highlight expand & shimmer
      Animated.timing(specularWidthAnim, {
        toValue: 1,
        duration: 320,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),

      // 4. Icon spring pop + optional alert twitch
      Animated.sequence([
        Animated.delay(40),
        Animated.parallel([
          Animated.spring(iconScaleAnim, {
            toValue: 1,
            damping: 11,
            stiffness: 360,
            mass: 0.65,
            useNativeDriver: true,
          }),
          ...(alertType === 'error' || alertType === 'destructive' || alertType === 'warning'
            ? [
                Animated.sequence([
                  Animated.timing(iconRotateAnim, { toValue: -1, duration: 60, useNativeDriver: true }),
                  Animated.timing(iconRotateAnim, { toValue: 1, duration: 80, useNativeDriver: true }),
                  Animated.timing(iconRotateAnim, { toValue: -0.4, duration: 60, useNativeDriver: true }),
                  Animated.timing(iconRotateAnim, { toValue: 0, duration: 60, useNativeDriver: true }),
                ]),
              ]
            : []),
        ]),
      ]),

      // 5. Content slide-in (staggered)
      Animated.sequence([
        Animated.delay(50),
        Animated.parallel([
          Animated.timing(contentFadeAnim, {
            toValue: 1,
            duration: 190,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.spring(contentTranslateYAnim, {
            toValue: 0,
            damping: 18,
            stiffness: 320,
            useNativeDriver: true,
          }),
        ]),
      ]),

      // 6. Action buttons float in (staggered)
      Animated.sequence([
        Animated.delay(80),
        Animated.parallel([
          Animated.timing(buttonsFadeAnim, {
            toValue: 1,
            duration: 200,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.spring(buttonsTranslateYAnim, {
            toValue: 0,
            damping: 18,
            stiffness: 320,
            useNativeDriver: true,
          }),
        ]),
      ]),
    ]).start();
  }, [
    backdropAnim,
    cardFadeAnim,
    cardScaleAnim,
    cardTranslateYAnim,
    iconScaleAnim,
    iconRotateAnim,
    contentFadeAnim,
    contentTranslateYAnim,
    buttonsFadeAnim,
    buttonsTranslateYAnim,
    specularWidthAnim,
  ]);

  // ─── Exit Motion Choreography ─────────────────────────────────────────────
  const runExitAnimation = useCallback((onDone: () => void) => {
    Animated.parallel([
      // Backdrop dissolves
      Animated.timing(backdropAnim, {
        toValue: 0,
        duration: 170,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
      // Card gracefully sinks and fades
      Animated.timing(cardFadeAnim, {
        toValue: 0,
        duration: 150,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(cardScaleAnim, {
        toValue: 0.92,
        duration: 150,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(cardTranslateYAnim, {
        toValue: 14,
        duration: 150,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
      // Quick content fade
      Animated.timing(contentFadeAnim, {
        toValue: 0,
        duration: 100,
        useNativeDriver: true,
      }),
      Animated.timing(buttonsFadeAnim, {
        toValue: 0,
        duration: 100,
        useNativeDriver: true,
      }),
    ]).start(() => onDone());
  }, [
    backdropAnim,
    cardFadeAnim,
    cardScaleAnim,
    cardTranslateYAnim,
    contentFadeAnim,
    buttonsFadeAnim,
  ]);

  useEffect(() => {
    const unsubscribe = alertEmitter.subscribe((payload) => {
      if (payload) {
        setCurrentAlert(payload);
        const { type } = resolveAlertType(payload);
        // Run enter after state flushes (next frame)
        requestAnimationFrame(() => runEnterAnimation(type));

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

  const iconRotate = iconRotateAnim.interpolate({
    inputRange: [-1, 0, 1],
    outputRange: ['-5deg', '0deg', '5deg'],
  });

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
              opacity: cardFadeAnim,
              transform: [
                { scale: cardScaleAnim },
                { translateY: cardTranslateYAnim },
              ],
            },
          ]}
        >
          {/* Top Subtle Bevel Specular Highlight with shimmer scaleX */}
          <Animated.View
            style={[
              styles.specularHighlight,
              {
                backgroundColor: isDark ? 'rgba(255, 255, 255, 0.18)' : 'rgba(255, 255, 255, 0.85)',
                opacity: specularWidthAnim,
                transform: [{ scaleX: specularWidthAnim }],
              },
            ]}
          />

          {/* Icon Badge with elastic spring & micro-rotation */}
          <Animated.View
            style={[
              styles.iconBadge,
              {
                backgroundColor: color + '18',
                borderColor: color + '40',
                transform: [
                  { scale: iconScaleAnim },
                  { rotate: iconRotate },
                ],
              },
            ]}
          >
            <FontAwesome name={icon} size={24} color={color} />
          </Animated.View>

          {/* Title & Message Content with Staggered Motion */}
          <Animated.View
            style={[
              styles.contentWrap,
              {
                opacity: contentFadeAnim,
                transform: [{ translateY: contentTranslateYAnim }],
              },
            ]}
          >
            <Text style={[styles.title, { color: textColor }]} numberOfLines={2}>
              {currentAlert.title}
            </Text>
            {Boolean(currentAlert.message) && (
              <Text style={[styles.message, { color: subtextColor }]}>
                {currentAlert.message}
              </Text>
            )}
          </Animated.View>

          {/* Action Buttons with Staggered Motion & Press Scaling */}
          <Animated.View
            style={[
              isDual ? styles.dualButtonRow : styles.stackedButtonColumn,
              {
                opacity: buttonsFadeAnim,
                transform: [{ translateY: buttonsTranslateYAnim }],
              },
            ]}
          >
            {buttons.map((btn, idx) => (
              <AnimatedAlertButton
                key={`${btn.text}-${idx}`}
                button={btn}
                index={idx}
                isDual={isDual}
                type={type}
                color={color}
                cancelBg={cancelBg}
                cancelBorder={cancelBorder}
                cancelText={cancelText}
                totalButtons={buttons.length}
                onPress={() => handleDismiss(btn)}
              />
            ))}
          </Animated.View>
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
  stackedButton: {
    width: '100%',
  },
  contentWrap: {
    width: '100%',
    alignItems: 'center',
  },
});
