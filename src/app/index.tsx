import React, { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import * as Haptics from 'expo-haptics';
import * as Battery from 'expo-battery';
import { Redirect, router, useFocusEffect } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useAppTheme } from '@/context/ThemeContext';
import {
  formatFileSize,
  getConfig,
  getQueue,
  getUploadedIndex,
  getSchedulerState,
  getActionHistory,
  QueueItem,
  UploadedRecord,
  ActionHistoryItem,
  AppConfig,
  SchedulerState,
  isRecordInMultiStream,
} from '@/lib/storage/queue';
import { tdLibClient } from '@/lib/tdlib/client';
import { schedulerEngine, calculateNextEstimatedRun } from '@/lib/scheduler/schedulerEngine';
import { analyzeCleanableSpace } from '@/lib/storage/cleaner';
import { FreeUpSpaceModal } from '@/components/FreeUpSpaceModal';
import { restoreFromCloudProfile, PROFILE_RESTORED_FLAG } from '@/lib/storage/cloudProfileSync';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { isDark, toggleTheme } = useAppTheme();

  const [onboardingStatus, setOnboardingStatus] = useState<'checking' | 'needed' | 'done'>('checking');
  const [loggedIn, setLoggedIn] = useState(false);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [schedulerState, setSchedulerState] = useState<SchedulerState | null>(null);
  const [queueInfo, setQueueInfo] = useState<{ count: number; totalBytes: number }>({
    count: 0,
    totalBytes: 0,
  });
  const [cloudStats, setCloudStats] = useState<{ count: number; totalBytes: number }>({
    count: 0,
    totalBytes: 0,
  });
  const [cleanableBytes, setCleanableBytes] = useState<number | null>(null);
  const [recentUploads, setRecentUploads] = useState<ActionHistoryItem[]>([]);
  const [batteryLevel, setBatteryLevel] = useState<number | null>(null);
  const [isCharging, setIsCharging] = useState<boolean | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [showFreeUpModal, setShowFreeUpModal] = useState(false);

  const checkStatus = async () => {
    try {
      const [
        loginStatus,
        initialConfig,
        initialQueue,
        initialUploaded,
        initialSched,
        history,
      ] = await Promise.all([
        tdLibClient.isLoggedIn().catch(() => false),
        getConfig(),
        getQueue().catch(() => []),
        getUploadedIndex().catch(() => []),
        getSchedulerState().catch(() => ({})),
        getActionHistory().catch(() => []),
      ]);

      // Update login status and initial config immediately so UI reflects connected state right away
      setLoggedIn(loginStatus);
      setConfig(initialConfig);
      setSchedulerState(initialSched);

      let appConfig = initialConfig;
      let queueItems = initialQueue;
      let uploadedItems = initialUploaded;
      let schedState = initialSched;

      if (loginStatus) {
        const alreadyRestored = await AsyncStorage.getItem(PROFILE_RESTORED_FLAG);
        if (!alreadyRestored) {
          const restoreRes = await restoreFromCloudProfile().catch(() => null);
          if (restoreRes?.restored) {
            console.log('[Home] Auto-restored profile from Telegram Saved Messages');
            const [freshConfig, freshQueue, freshUploaded, freshSched] = await Promise.all([
              getConfig(),
              getQueue().catch(() => []),
              getUploadedIndex().catch(() => []),
              getSchedulerState().catch(() => ({})),
            ]);
            appConfig = freshConfig;
            schedState = freshSched;
            queueItems = freshQueue;
            uploadedItems = freshUploaded;
            setConfig(appConfig);
            setSchedulerState(schedState);
            Alert.alert(
              'Profile Restored from Telegram',
              'Your previous settings, watched folders, and upload history were successfully restored from Telegram Cloud.'
            );
          }
        }
      }

      const qBytes = (queueItems || []).reduce(
        (acc: number, item: QueueItem) => acc + (item.size || 0),
        0
      );
      setQueueInfo({ count: (queueItems || []).length, totalBytes: qBytes });

      let activeCloudItems = uploadedItems || [];
      if (appConfig?.multiChannelRouting) {
        activeCloudItems = activeCloudItems.filter((rec) => isRecordInMultiStream(rec, appConfig));
      }

      const cBytes = activeCloudItems.reduce(
        (acc: number, item: UploadedRecord) => acc + (item.size || 0),
        0
      );
      setCloudStats({ count: activeCloudItems.length, totalBytes: cBytes });

      // Recent 3 uploaded items
      setRecentUploads(
        (history || []).filter((h) => h.status === 'uploaded').slice(0, 3)
      );

      // Async battery & cleaner scans in background
      Battery.isAvailableAsync()
        .then(async (avail) => {
          if (!avail) return;
          const [level, state] = await Promise.all([
            Battery.getBatteryLevelAsync().catch(() => -1),
            Battery.getBatteryStateAsync().catch(() => Battery.BatteryState.UNKNOWN),
          ]);
          if (level >= 0) setBatteryLevel(Math.round(level * 100));
          setIsCharging(
            state === Battery.BatteryState.CHARGING || state === Battery.BatteryState.FULL
          );
        })
        .catch(() => {});

      analyzeCleanableSpace()
        .then((analysis) => {
          setCleanableBytes(analysis.totalBytes);
        })
        .catch(() => {});
    } catch (error) {
      console.error('Home load error:', error);
    }
  };

  // Guard: check onboarding completion status
  useEffect(() => {
    let active = true;
    AsyncStorage.getItem('nimo_onboarding_done').then((val) => {
      if (!active) return;
      const isDone = val === '1' || val === 'true';
      if (!isDone) {
        setOnboardingStatus('needed');
      } else {
        setOnboardingStatus('done');
      }
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (onboardingStatus === 'done') {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [onboardingStatus]);

  // Re-fetch data when the screen comes into focus.
  useFocusEffect(
    useCallback(() => {
      if (onboardingStatus === 'done') {
        checkStatus();
      }
      const unsub = tdLibClient.onAuthStateChange((state) => {
        const isReady = state === 'authorizationStateReady';
        setLoggedIn(isReady);
        if (isReady && onboardingStatus === 'done') {
          checkStatus();
        }
      });
      return () => {
        unsub();
      };
    }, [onboardingStatus])
  );

  const handleSyncNow = async () => {
    if (isSyncing) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setIsSyncing(true);

    try {
      await schedulerEngine.executeScheduler({
        forceManual: true,
        triggerSource: 'manual',
      });
      await checkStatus();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (err: any) {
      console.warn('Manual sync trigger error:', err);
    } finally {
      setIsSyncing(false);
    }
  };

  if (onboardingStatus === 'checking') {
    return null;
  }

  if (onboardingStatus === 'needed') {
    return <Redirect href={'/onboarding' as any} />;
  }

  const bg = isDark ? '#0F172A' : '#F8FAFC';
  const cardBg = isDark ? '#1E293B' : '#FFFFFF';
  const textColor = isDark ? '#F8FAFC' : '#0F172A';
  const subtextColor = isDark ? '#94A3B8' : '#64748B';
  const border = isDark ? '#334155' : '#E2E8F0';

  const nextRunInfo = config
    ? calculateNextEstimatedRun(config, schedulerState?.lastRunAt)
    : null;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: bg }]} edges={['top', 'left', 'right']}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* App Bar Header */}
        <View style={styles.topBarRow}>
          <View style={styles.brandGroup}>
            <Image
              style={styles.headerLogo}
              source={require('@/assets/images/app-logo.png')}
              resizeMode="contain"
            />
            <View>
              <Text style={[styles.brandTitle, { color: textColor }]}>Nimo Save Storage</Text>
              <Text style={[styles.brandSub, { color: subtextColor }]}>Unlimited Telegram Cloud</Text>
            </View>
          </View>

          <View style={styles.topRightPills}>
            {batteryLevel !== null && (
              <View style={[styles.batteryPill, { backgroundColor: cardBg, borderColor: border }]}>
                <FontAwesome
                  name={isCharging ? 'bolt' : 'battery-three-quarters'}
                  size={11}
                  color={isCharging ? '#10B981' : '#64748B'}
                />
                <Text style={[styles.batteryPillText, { color: subtextColor }]}>
                  {batteryLevel}%
                </Text>
              </View>
            )}

            {/* Quick Theme Toggle Button */}
            <TouchableOpacity
              style={[styles.settingsIconBtn, { backgroundColor: cardBg, borderColor: border }]}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                toggleTheme();
              }}
              accessibilityLabel="Toggle Light / Dark mode"
            >
              <FontAwesome
                name={isDark ? 'sun-o' : 'moon-o'}
                size={16}
                color={isDark ? '#F59E0B' : '#6366F1'}
              />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.settingsIconBtn, { backgroundColor: cardBg, borderColor: border }]}
              onPress={() => {
                Haptics.selectionAsync().catch(() => {});
                router.push('/settings');
              }}
            >
              <FontAwesome name="cog" size={17} color="#64748B" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Telegram Auth Warning Banner if not logged in */}
        {!loggedIn && (
          <TouchableOpacity
            style={styles.authAlertBanner}
            onPress={() => router.push('/telegram-login')}
            activeOpacity={0.8}
          >
            <View style={styles.authAlertContent}>
              <FontAwesome name="exclamation-circle" size={18} color="#FFFFFF" />
              <View style={styles.authAlertTextWrap}>
                <Text style={styles.authAlertTitle}>Telegram Disconnected</Text>
                <Text style={styles.authAlertSub}>Tap here to connect your Telegram account and start backing up</Text>
              </View>
            </View>
            <FontAwesome name="arrow-right" size={14} color="#FFFFFF" />
          </TouchableOpacity>
        )}

        {/* HERO STORAGE CARD */}
        <View style={[styles.heroCard, { backgroundColor: isDark ? '#1E293B' : '#0F172A' }]}>
          <View style={styles.heroTopRow}>
            <View>
              <Text style={styles.heroSubhead}>TOTAL CLOUD BACKUP</Text>
              <Text style={styles.heroHeadline}>
                {formatFileSize(cloudStats.totalBytes)}
              </Text>
            </View>
            <View style={styles.heroBadge}>
              <FontAwesome name="cloud" size={16} color="#60A5FA" />
              <Text style={styles.heroBadgeText}>{cloudStats.count} files</Text>
            </View>
          </View>

          <View style={styles.heroMetaDivider} />

          <View style={styles.heroBottomRow}>
            <View style={styles.heroMetaItem}>
              <FontAwesome name="comment" size={11} color="#93C5FD" style={{ marginRight: 5 }} />
              <Text style={styles.heroMetaText} numberOfLines={1}>
                {config?.multiChannelRouting
                  ? 'Multi-Stream (3 Channels)'
                  : config?.uploadToSavedMessages || config?.targetChatId === 'me'
                  ? 'Saved Messages'
                  : config?.targetChatTitle || 'Target Channel'}
              </Text>
            </View>

            <View style={styles.heroMetaItem}>
              <View
                style={[
                  styles.statusDot,
                  { backgroundColor: config?.autoUploadEnabled ? '#10B981' : '#F59E0B' },
                ]}
              />
              <Text style={styles.heroMetaText}>
                {config?.autoUploadEnabled
                  ? nextRunInfo?.humanText || 'Active'
                  : 'Auto-Sync Off'}
              </Text>
            </View>
          </View>
        </View>

        {/* QUICK ACTION GRID (2 x 2) */}
        <Text style={[styles.sectionHeading, { color: textColor }]}>Quick Actions</Text>
        <View style={styles.actionGrid}>
          {/* Card 1: Cloud Explorer */}
          <TouchableOpacity
            style={[styles.actionCard, { backgroundColor: cardBg, borderColor: border }]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
              router.push('/explore');
            }}
            activeOpacity={0.7}
          >
            <View style={[styles.actionIconBox, { backgroundColor: '#EFF6FF' }]}>
              <FontAwesome name="folder-open" size={18} color="#208AEF" />
            </View>
            <Text style={[styles.actionTitle, { color: textColor }]}>Cloud Explorer</Text>
            <Text style={[styles.actionSub, { color: subtextColor }]}>
              Browse backed up photos & media
            </Text>
            <View style={styles.actionBadgePill}>
              <Text style={styles.actionBadgePillText}>{cloudStats.count} in Cloud</Text>
            </View>
          </TouchableOpacity>

          {/* Card 2: Upload Queue */}
          <TouchableOpacity
            style={[styles.actionCard, { backgroundColor: cardBg, borderColor: border }]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
              router.push('/upload');
            }}
            activeOpacity={0.7}
          >
            <View style={[styles.actionIconBox, { backgroundColor: '#F5F3FF' }]}>
              <FontAwesome name="cloud-upload" size={18} color="#7C3AED" />
            </View>
            <Text style={[styles.actionTitle, { color: textColor }]}>Upload Queue</Text>
            <Text style={[styles.actionSub, { color: subtextColor }]}>
              Monitor transfers & pending files
            </Text>
            <View style={[styles.actionBadgePill, { backgroundColor: '#F5F3FF' }]}>
              <Text style={[styles.actionBadgePillText, { color: '#7C3AED' }]}>
                {queueInfo.count} Pending
              </Text>
            </View>
          </TouchableOpacity>

          {/* Card 3: Free Up Space Cleaner */}
          <TouchableOpacity
            style={[styles.actionCard, { backgroundColor: cardBg, borderColor: border }]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
              setShowFreeUpModal(true);
            }}
            activeOpacity={0.7}
          >
            <View style={[styles.actionIconBox, { backgroundColor: '#ECFDF5' }]}>
              <FontAwesome name="recycle" size={18} color="#10B981" />
            </View>
            <Text style={[styles.actionTitle, { color: textColor }]}>Free Up Space</Text>
            <Text style={[styles.actionSub, { color: subtextColor }]}>
              Clean local files saved in cloud
            </Text>
            <View style={[styles.actionBadgePill, { backgroundColor: '#ECFDF5' }]}>
              <Text style={[styles.actionBadgePillText, { color: '#059669' }]}>
                {cleanableBytes !== null && cleanableBytes > 0
                  ? `${formatFileSize(cleanableBytes)} Freeable`
                  : 'Up to date'}
              </Text>
            </View>
          </TouchableOpacity>

          {/* Card 4: Settings & Security */}
          <TouchableOpacity
            style={[styles.actionCard, { backgroundColor: cardBg, borderColor: border }]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
              router.push('/settings');
            }}
            activeOpacity={0.7}
          >
            <View style={[styles.actionIconBox, { backgroundColor: '#FEF3C7' }]}>
              <FontAwesome name="shield" size={18} color="#D97706" />
            </View>
            <Text style={[styles.actionTitle, { color: textColor }]}>Preferences</Text>
            <Text style={[styles.actionSub, { color: subtextColor }]}>
              Rules, battery guard & app lock
            </Text>
            <View style={[styles.actionBadgePill, { backgroundColor: '#FEF3C7' }]}>
              <Text style={[styles.actionBadgePillText, { color: '#B45309' }]}>
                {config?.scheduleMode === 'interval'
                  ? `Every ${config.intervalMinutes ?? 1}m`
                  : 'Configured'}
              </Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* LIVE SYNC ACTION BUTTON */}
        <TouchableOpacity
          style={[styles.syncNowBtn, isSyncing && styles.btnDisabled]}
          onPress={handleSyncNow}
          disabled={isSyncing}
          activeOpacity={0.8}
        >
          {isSyncing ? (
            <View style={styles.syncBtnRow}>
              <ActivityIndicator size="small" color="#FFFFFF" style={{ marginRight: 8 }} />
              <Text style={styles.syncNowBtnText}>Scanning & Syncing Folders...</Text>
            </View>
          ) : (
            <View style={styles.syncBtnRow}>
              <FontAwesome name="bolt" size={15} color="#FFFFFF" style={{ marginRight: 8 }} />
              <Text style={styles.syncNowBtnText}>Sync Cloud Now</Text>
            </View>
          )}
        </TouchableOpacity>

        {/* RECENT UPLOADS STREAM PREVIEW */}
        <View style={styles.recentSectionHeader}>
          <Text style={[styles.sectionHeading, { color: textColor, marginBottom: 0 }]}>
            Recent Cloud Backups
          </Text>
          <TouchableOpacity onPress={() => router.push('/explore')}>
            <Text style={styles.seeAllText}>See all ({cloudStats.count})</Text>
          </TouchableOpacity>
        </View>

        {recentUploads.length === 0 ? (
          <View style={[styles.emptyRecentCard, { backgroundColor: cardBg, borderColor: border }]}>
            <FontAwesome name="cloud" size={24} color="#94A3B8" />
            <Text style={[styles.emptyRecentText, { color: subtextColor }]}>
              {'No recent uploads. Tap "Sync Cloud Now" or configure folders in Queue.'}
            </Text>
          </View>
        ) : (
          <View style={styles.recentListWrap}>
            {recentUploads.map((item) => (
              <View
                key={item.id}
                style={[styles.recentItemRow, { backgroundColor: cardBg, borderColor: border }]}
              >
                <View style={styles.recentIconBox}>
                  <FontAwesome name="check-circle" size={16} color="#10B981" />
                </View>
                <View style={styles.recentInfo}>
                  <Text style={[styles.recentTitle, { color: textColor }]} numberOfLines={1}>
                    {item.fileName}
                  </Text>
                  <Text style={[styles.recentMeta, { color: subtextColor }]}>
                    {formatFileSize(item.size)} • {item.destination || 'Preserved in Telegram'}
                  </Text>
                </View>
                <Text style={[styles.recentTime, { color: subtextColor }]}>
                  {new Date(item.timestamp).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </Text>
              </View>
            ))}
          </View>
        )}

        <View style={{ height: Math.max(insets.bottom, 20) + 24 }} />
      </ScrollView>

      {/* Free Up Space Modal */}
      <FreeUpSpaceModal
        visible={showFreeUpModal}
        onClose={() => setShowFreeUpModal(false)}
        onCleanComplete={() => {
          checkStatus();
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 24,
  },
  topBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  brandGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerLogo: {
    width: 38,
    height: 38,
    borderRadius: 8,
  },
  brandTitle: {
    fontSize: 16,
    fontWeight: '800',
  },
  brandSub: {
    fontSize: 11,
    marginTop: 1,
  },
  topRightPills: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  batteryPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
  },
  batteryPillText: {
    fontSize: 11,
    fontWeight: '600',
  },
  settingsIconBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  authAlertBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#EF4444',
    padding: 14,
    borderRadius: 14,
    marginBottom: 16,
  },
  authAlertContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
    marginRight: 10,
  },
  authAlertTextWrap: {
    flex: 1,
  },
  authAlertTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  authAlertSub: {
    color: 'rgba(255, 255, 255, 0.9)',
    fontSize: 11,
    marginTop: 2,
  },
  heroCard: {
    borderRadius: 20,
    padding: 20,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 6,
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  heroSubhead: {
    fontSize: 11,
    fontWeight: '700',
    color: '#93C5FD',
    letterSpacing: 0.8,
  },
  heroHeadline: {
    fontSize: 32,
    fontWeight: '900',
    color: '#FFFFFF',
    marginTop: 4,
  },
  heroBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(59, 130, 246, 0.2)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    gap: 6,
  },
  heroBadgeText: {
    color: '#93C5FD',
    fontSize: 12,
    fontWeight: '700',
  },
  heroMetaDivider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    marginVertical: 16,
  },
  heroBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  heroMetaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    maxWidth: '50%',
  },
  heroMetaText: {
    color: 'rgba(255, 255, 255, 0.85)',
    fontSize: 12,
    fontWeight: '600',
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    marginRight: 6,
  },
  sectionHeading: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 10,
  },
  actionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 16,
  },
  actionCard: {
    width: (SCREEN_WIDTH - 32 - 12) / 2,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
  },
  actionIconBox: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  actionTitle: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 2,
  },
  actionSub: {
    fontSize: 11,
    lineHeight: 15,
    marginBottom: 10,
  },
  actionBadgePill: {
    alignSelf: 'flex-start',
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  actionBadgePillText: {
    color: '#208AEF',
    fontSize: 10,
    fontWeight: '700',
  },
  syncNowBtn: {
    backgroundColor: '#208AEF',
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    shadowColor: '#208AEF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  btnDisabled: {
    opacity: 0.6,
  },
  syncBtnRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  syncNowBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  recentSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  seeAllText: {
    fontSize: 12,
    color: '#208AEF',
    fontWeight: '600',
  },
  emptyRecentCard: {
    padding: 24,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  emptyRecentText: {
    fontSize: 12,
    textAlign: 'center',
  },
  recentListWrap: {
    gap: 8,
  },
  recentItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  recentIconBox: {
    marginRight: 10,
  },
  recentInfo: {
    flex: 1,
    marginRight: 8,
  },
  recentTitle: {
    fontSize: 13,
    fontWeight: '600',
  },
  recentMeta: {
    fontSize: 11,
    marginTop: 2,
  },
  recentTime: {
    fontSize: 11,
    fontWeight: '500',
  },
});
