import React, { useState, useCallback } from 'react';
import {
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useColorScheme,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';

const TOTAL_STEPS = 4;

interface StepConfig {
  icon: React.ComponentProps<typeof FontAwesome>['name'];
  iconColor: string;
  title: string;
  body: string;
  ctaLabel: string;
  skipLabel?: string;
}

const STEPS: StepConfig[] = [
  {
    icon: 'cloud-upload',
    iconColor: '#208AEF',
    title: 'Welcome to Nimo Save',
    body: 'Your personal cloud backup powered by Telegram. Secure, private, unlimited storage.',
    ctaLabel: 'Get Started →',
  },
  {
    icon: 'send',
    iconColor: '#229ED9',
    title: 'Connect Your Telegram',
    body: 'Nimo uses your Telegram account to store files securely in a private channel only you can access.',
    ctaLabel: 'Connect Telegram',
    skipLabel: 'Skip for now →',
  },
  {
    icon: 'folder-open',
    iconColor: '#10B981',
    title: 'Pick Folders to Back Up',
    body: 'Choose which folders on your device Nimo should automatically watch and back up.',
    ctaLabel: 'Choose Folders →',
    skipLabel: 'Skip for now →',
  },
  {
    icon: 'check-circle',
    iconColor: '#22C55E',
    title: "You're All Set!",
    body: 'Nimo will automatically back up your files in the background. Tap the dashboard to get started.',
    ctaLabel: 'Open Dashboard',
  },
];

export default function OnboardingScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  const [step, setStep] = useState(0);
  // useState lazy initializer: creates Animated.Value once, never causes re-render on its own
  const [opacityAnim] = useState(() => new Animated.Value(1));

  const animateTransition = useCallback((next: () => void) => {
    Animated.timing(opacityAnim, {
      toValue: 0,
      duration: 100,
      useNativeDriver: true,
    }).start(() => {
      next();
      Animated.timing(opacityAnim, {
        toValue: 1,
        duration: 100,
        useNativeDriver: true,
      }).start();
    });
  }, [opacityAnim]);

  const goToStep = useCallback((nextStep: number) => {
    animateTransition(() => setStep(nextStep));
  }, [animateTransition]);

  const handleBack = useCallback(() => {
    if (step > 0) goToStep(step - 1);
  }, [step, goToStep]);

  const handleCta = useCallback(async () => {
    if (step === 0) {
      // Welcome → Connect Telegram
      goToStep(1);
    } else if (step === 1) {
      // Connect Telegram → push to login, advance wizard
      router.push('/telegram-login');
      goToStep(2);
    } else if (step === 2) {
      // Choose Folders → just advance
      goToStep(3);
    } else if (step === 3) {
      // All Set → save flag and go to dashboard
      await AsyncStorage.setItem('nimo_onboarding_done', '1');
      router.replace('/');
    }
  }, [step, goToStep]);

  const handleSkip = useCallback(() => {
    if (step < TOTAL_STEPS - 1) {
      goToStep(step + 1);
    }
  }, [step, goToStep]);

  const current = STEPS[step];

  const bg = isDark ? '#0A0F1E' : '#FFFFFF';
  const textPrimary = isDark ? '#FFFFFF' : '#0F172A';
  const textSecondary = isDark ? '#94A3B8' : '#64748B';

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: bg }]}>
      {/* Back button */}
      <View style={styles.topBar}>
        {step > 0 ? (
          <TouchableOpacity onPress={handleBack} style={styles.backButton} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <FontAwesome name="chevron-left" size={18} color={textSecondary} />
          </TouchableOpacity>
        ) : (
          <View style={styles.backPlaceholder} />
        )}
        <Text style={[styles.stepCounter, { color: textSecondary }]}>
          Step {step + 1} of {TOTAL_STEPS}
        </Text>
        <View style={styles.backPlaceholder} />
      </View>

      {/* Animated content */}
      <Animated.View style={[styles.contentWrapper, { opacity: opacityAnim }]}>
        {/* Icon */}
        <View style={styles.iconWrapper}>
          <FontAwesome name={current.icon} size={60} color={current.iconColor} />
        </View>

        {/* Title */}
        <Text style={[styles.title, { color: textPrimary }]}>{current.title}</Text>

        {/* Body */}
        <Text style={[styles.body, { color: textSecondary }]}>{current.body}</Text>
      </Animated.View>

      {/* Bottom area */}
      <View style={styles.bottomArea}>
        {/* Step dots */}
        <View style={styles.dotsRow}>
          {STEPS.map((_, i) => (
            <View
              key={i}
              style={[
                styles.dot,
                i === step ? styles.dotActive : [styles.dotInactive, { borderColor: textSecondary }],
              ]}
            />
          ))}
        </View>

        {/* CTA Button */}
        <TouchableOpacity style={styles.ctaButton} onPress={handleCta} activeOpacity={0.85}>
          <Text style={styles.ctaLabel}>{current.ctaLabel}</Text>
        </TouchableOpacity>

        {/* Skip link */}
        {current.skipLabel ? (
          <TouchableOpacity onPress={handleSkip} style={styles.skipWrapper} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.skipText}>{current.skipLabel}</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.skipPlaceholder} />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 4,
  },
  backButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backPlaceholder: {
    width: 36,
    height: 36,
  },
  stepCounter: {
    fontSize: 13,
    fontWeight: '500',
  },
  contentWrapper: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  iconWrapper: {
    marginBottom: 32,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 34,
  },
  body: {
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 24,
  },
  bottomArea: {
    paddingHorizontal: 24,
    paddingBottom: 20,
    alignItems: 'center',
  },
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 28,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  dotActive: {
    backgroundColor: '#208AEF',
  },
  dotInactive: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
  },
  ctaButton: {
    width: '100%',
    height: 56,
    backgroundColor: '#208AEF',
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  ctaLabel: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  skipWrapper: {
    paddingVertical: 4,
  },
  skipText: {
    color: '#9CA3AF',
    fontSize: 14,
    textAlign: 'center',
  },
  skipPlaceholder: {
    height: 26,
  },
});
