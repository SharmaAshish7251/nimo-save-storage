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
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';

const TOTAL_STEPS = 4;

interface BenefitItem {
  icon: React.ComponentProps<typeof FontAwesome>['name'];
  title: string;
  description: string;
}

interface StepConfig {
  tag: string;
  icon: React.ComponentProps<typeof FontAwesome>['name'];
  iconColor: string;
  glowColor: string;
  title: string;
  subtitle: string;
  ctaLabel: string;
  benefits: BenefitItem[];
}

const STEPS: StepConfig[] = [
  {
    tag: 'PERSONAL CLOUD BACKUP',
    icon: 'cloud-upload',
    iconColor: '#38BDF8',
    glowColor: 'rgba(56, 189, 248, 0.15)',
    title: 'Your Private Cloud, Zero Subscription',
    subtitle: 'Harness Telegram’s unlimited cloud infrastructure to safeguard all your photos, 4K videos, and files.',
    ctaLabel: 'Get Started',
    benefits: [
      {
        icon: 'database',
        title: 'Unlimited Cloud Storage',
        description: 'Store gigabytes of high-res media with no monthly fees.',
      },
      {
        icon: 'shield',
        title: '100% Private & Encrypted',
        description: 'Directly stored in your personal Telegram Saved Messages.',
      },
      {
        icon: 'image',
        title: 'Original Bit-for-Bit Quality',
        description: 'Zero lossy compression on photos and videos.',
      },
    ],
  },
  {
    tag: 'SECURE INTEGRATION',
    icon: 'send',
    iconColor: '#229ED9',
    glowColor: 'rgba(34, 158, 217, 0.15)',
    title: 'Connect Your Telegram in Seconds',
    subtitle: 'Nimo talks directly to Telegram’s official TDLib engine with no intermediaries or third-party servers.',
    ctaLabel: 'Connect Telegram Now',
    benefits: [
      {
        icon: 'lock',
        title: 'Direct Official TDLib Protocol',
        description: 'Credentials stay exclusively on your device.',
      },
      {
        icon: 'bolt',
        title: 'Turbocharged Parallel Uploads',
        description: 'High-speed chunked transfers with pause and resume.',
      },
      {
        icon: 'desktop',
        title: 'Multi-Device Availability',
        description: 'Access your backup from mobile, tablet, and PC.',
      },
    ],
  },
  {
    tag: 'SMART AUTOMATION',
    icon: 'refresh',
    iconColor: '#10B981',
    glowColor: 'rgba(16, 185, 129, 0.15)',
    title: 'Intelligent Background Sync',
    subtitle: 'Automatically detects new photos and documents so your memories are protected without opening the app.',
    ctaLabel: 'Configure & Continue',
    benefits: [
      {
        icon: 'folder-open',
        title: 'Watched Folder Scanner',
        description: 'Auto-scans Camera, Downloads, and custom folders.',
      },
      {
        icon: 'battery-three-quarters',
        title: 'Battery Guard Protection',
        description: 'Intelligently pauses sync when battery is low.',
      },
      {
        icon: 'wifi',
        title: 'Wi-Fi Only & Metered Guard',
        description: 'Preserves cellular data by syncing on fast Wi-Fi.',
      },
    ],
  },
  {
    tag: 'ALL SYSTEMS OPERATIONAL',
    icon: 'check-circle',
    iconColor: '#22C55E',
    glowColor: 'rgba(34, 197, 94, 0.15)',
    title: "You're Ready to Launch!",
    subtitle: 'Your private cloud vault is ready. Keep your storage clean and your media organized forever.',
    ctaLabel: 'Open Dashboard',
    benefits: [
      {
        icon: 'lock',
        title: 'Biometric App Lock Ready',
        description: 'Fingerprint and Face Unlock security built right in.',
      },
      {
        icon: 'trash',
        title: 'One-Tap Space Cleaner',
        description: 'Safely remove uploaded local media to reclaim device storage.',
      },
      {
        icon: 'rocket',
        title: 'Always-On Background Engine',
        description: 'Hands-off automatic sync ready to back up your world.',
      },
    ],
  },
];

export default function OnboardingScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  const [step, setStep] = useState(0);

  // Animation values for smooth cross-fade & micro-slide
  const [fadeAnim] = useState(() => new Animated.Value(1));
  const [slideAnim] = useState(() => new Animated.Value(0));

  const animateTransition = useCallback(
    (nextStep: number) => {
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 120,
          useNativeDriver: true,
        }),
        Animated.timing(slideAnim, {
          toValue: -8,
          duration: 120,
          useNativeDriver: true,
        }),
      ]).start(() => {
        setStep(nextStep);
        slideAnim.setValue(8);
        Animated.parallel([
          Animated.timing(fadeAnim, {
            toValue: 1,
            duration: 160,
            useNativeDriver: true,
          }),
          Animated.timing(slideAnim, {
            toValue: 0,
            duration: 160,
            useNativeDriver: true,
          }),
        ]).start();
      });
    },
    [fadeAnim, slideAnim]
  );

  const goToStep = useCallback(
    async (nextStep: number) => {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      animateTransition(nextStep);
    },
    [animateTransition]
  );

  const handleBack = useCallback(async () => {
    if (step > 0) {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      goToStep(step - 1);
    }
  }, [step, goToStep]);

  const finishOnboarding = useCallback(async () => {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await AsyncStorage.setItem('nimo_onboarding_done', '1');
    router.replace('/');
  }, []);

  const handleCta = useCallback(async () => {
    if (step === 0) {
      goToStep(1);
    } else if (step === 1) {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await AsyncStorage.setItem('nimo_onboarding_done', '1');
      router.push('/telegram-login');
    } else if (step === 2) {
      goToStep(3);
    } else if (step === 3) {
      await finishOnboarding();
    }
  }, [step, goToStep, finishOnboarding]);

  const handleSkip = useCallback(async () => {
    await finishOnboarding();
  }, [finishOnboarding]);

  const current = STEPS[step];

  // Theme palette
  const bg = isDark ? '#070B14' : '#F8FAFC';
  const cardBg = isDark ? '#0F172A' : '#FFFFFF';
  const cardBorder = isDark ? '#1E293B' : '#E2E8F0';
  const textPrimary = isDark ? '#F8FAFC' : '#0F172A';
  const textSecondary = isDark ? '#94A3B8' : '#64748B';
  const benefitCardBg = isDark ? 'rgba(15, 23, 42, 0.65)' : 'rgba(255, 255, 255, 0.9)';

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: bg }]}>
      {/* ── Top Header Navigation Bar ── */}
      <View style={styles.topBar}>
        {step > 0 ? (
          <TouchableOpacity
            onPress={handleBack}
            style={[styles.navIconButton, { backgroundColor: cardBg, borderColor: cardBorder }]}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityLabel="Go back"
          >
            <FontAwesome name="chevron-left" size={13} color={textPrimary} />
          </TouchableOpacity>
        ) : (
          <View style={styles.navPlaceholder} />
        )}

        {/* Step Badge Pill */}
        <View style={[styles.stepBadge, { backgroundColor: cardBg, borderColor: cardBorder }]}>
          <Text style={[styles.stepBadgeText, { color: textSecondary }]}>
            STEP {step + 1} OF {TOTAL_STEPS}
          </Text>
        </View>

        {step < TOTAL_STEPS - 1 ? (
          <TouchableOpacity
            onPress={handleSkip}
            style={styles.skipButton}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Text style={[styles.skipButtonText, { color: textSecondary }]}>Skip</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.navPlaceholder} />
        )}
      </View>

      {/* ── Main Animated Slide Content ── */}
      <Animated.ScrollView
        style={[
          styles.scrollContent,
          {
            opacity: fadeAnim,
            transform: [{ translateY: slideAnim }],
          },
        ]}
        contentContainerStyle={styles.scrollInner}
        showsVerticalScrollIndicator={false}
      >
        {/* Glowing Icon Halo */}
        <View style={styles.heroHaloContainer}>
          <View style={[styles.outerHalo, { backgroundColor: current.glowColor, borderColor: current.iconColor + '33' }]}>
            <View style={[styles.innerHalo, { backgroundColor: cardBg, borderColor: current.iconColor + '4D' }]}>
              <FontAwesome name={current.icon} size={38} color={current.iconColor} />
            </View>
          </View>
        </View>

        {/* Tag Pill */}
        <View style={[styles.tagPill, { backgroundColor: current.iconColor + '18', borderColor: current.iconColor + '33' }]}>
          <Text style={[styles.tagPillText, { color: current.iconColor }]}>{current.tag}</Text>
        </View>

        {/* Title & Subtitle */}
        <Text style={[styles.title, { color: textPrimary }]}>{current.title}</Text>
        <Text style={[styles.subtitle, { color: textSecondary }]}>{current.subtitle}</Text>

        {/* Benefits List Card */}
        <View style={[styles.benefitsCard, { backgroundColor: benefitCardBg, borderColor: cardBorder }]}>
          {current.benefits.map((item, index) => (
            <View
              key={index}
              style={[
                styles.benefitRow,
                index < current.benefits.length - 1 && [styles.benefitDivider, { borderBottomColor: cardBorder }],
              ]}
            >
              <View style={[styles.benefitIconBox, { backgroundColor: current.iconColor + '15' }]}>
                <FontAwesome name={item.icon} size={15} color={current.iconColor} />
              </View>
              <View style={styles.benefitTextBox}>
                <Text style={[styles.benefitTitle, { color: textPrimary }]}>{item.title}</Text>
                <Text style={[styles.benefitDescription, { color: textSecondary }]}>
                  {item.description}
                </Text>
              </View>
            </View>
          ))}
        </View>
      </Animated.ScrollView>

      {/* ── Bottom Controls ── */}
      <View style={[styles.bottomArea, { borderTopColor: cardBorder }]}>
        {/* Progress Dots Indicator */}
        <View style={styles.dotsRow}>
          {STEPS.map((_, i) => {
            const isActive = i === step;
            return (
              <View
                key={i}
                style={[
                  styles.dot,
                  isActive
                    ? [styles.dotActive, { backgroundColor: current.iconColor }]
                    : [styles.dotInactive, { backgroundColor: isDark ? '#1E293B' : '#E2E8F0' }],
                ]}
              />
            );
          })}
        </View>

        {/* Primary CTA Button */}
        <TouchableOpacity
          style={[styles.ctaButton, { backgroundColor: current.iconColor }]}
          onPress={handleCta}
          activeOpacity={0.88}
        >
          <Text style={styles.ctaLabel}>{current.ctaLabel}</Text>
          <FontAwesome name="arrow-right" size={14} color="#FFFFFF" style={styles.ctaIcon} />
        </TouchableOpacity>

        {/* Secondary Sub-action */}
        {step === 1 && (
          <TouchableOpacity onPress={() => goToStep(2)} style={styles.subActionBtn}>
            <Text style={[styles.subActionText, { color: textSecondary }]}>
              I&apos;ll connect my account later
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },

  /* Top Bar */
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  navIconButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navPlaceholder: {
    width: 36,
    height: 36,
  },
  stepBadge: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
  },
  stepBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  skipButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  skipButtonText: {
    fontSize: 13,
    fontWeight: '600',
  },

  /* Scroll Content */
  scrollContent: {
    flex: 1,
  },
  scrollInner: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 24,
  },

  /* Hero Glowing Halo */
  heroHaloContainer: {
    marginBottom: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  outerHalo: {
    width: 108,
    height: 108,
    borderRadius: 54,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  innerHalo: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* Tag Pill */
  tagPill: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 12,
  },
  tagPillText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
  },

  /* Title & Subtitle */
  title: {
    fontSize: 24,
    fontWeight: '800',
    textAlign: 'center',
    lineHeight: 32,
    marginBottom: 10,
    paddingHorizontal: 8,
  },
  subtitle: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: 22,
    paddingHorizontal: 6,
  },

  /* Benefits List Card */
  benefitsCard: {
    width: '100%',
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  benefitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
  },
  benefitDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  benefitIconBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  benefitTextBox: {
    flex: 1,
  },
  benefitTitle: {
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 2,
  },
  benefitDescription: {
    fontSize: 12,
    lineHeight: 16,
  },

  /* Bottom Area */
  bottomArea: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 24,
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 18,
  },
  dot: {
    height: 6,
    borderRadius: 3,
  },
  dotActive: {
    width: 26,
  },
  dotInactive: {
    width: 6,
  },
  ctaButton: {
    width: '100%',
    height: 52,
    borderRadius: 26,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  ctaLabel: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  ctaIcon: {
    marginLeft: 8,
  },
  subActionBtn: {
    marginTop: 12,
    paddingVertical: 4,
  },
  subActionText: {
    fontSize: 13,
    fontWeight: '600',
  },
});
