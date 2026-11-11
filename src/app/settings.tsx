import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  StyleSheet,
  Text,
  TouchableOpacity,
  Switch,
  TextInput,
  ScrollView,
  Image,
  ActivityIndicator,
  Alert,
  useColorScheme,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import * as Haptics from 'expo-haptics';
import * as Battery from 'expo-battery';
import * as LocalAuthentication from 'expo-local-authentication';
import {
  getConfig,
  saveConfig,
  getSchedulerState,
  AppConfig,
  SchedulerState,
  ScheduleMode,
  formatFileSize,
} from '@/lib/storage/queue';
import { requestMediaPermissions } from '@/lib/scanner/files';
import {
  registerBackgroundUploadTask,
  unregisterBackgroundUploadTask,
} from '@/tasks/backgroundUpload';
import { DestinationSelector } from '@/components/DestinationSelector';
import { TimeDialerModal } from '@/components/TimeDialerModal';
import { FreeUpSpaceModal } from '@/components/FreeUpSpaceModal';
import { analyzeCleanableSpace } from '@/lib/storage/cleaner';
import { tdLibClient } from '@/lib/tdlib/client';
import * as SecureStoreLib from '@/lib/storage/secure';
import {
  schedulerEngine,
  calculateNextEstimatedRun,
} from '@/lib/scheduler/schedulerEngine';

const INTERVAL_PRESETS = [
  { label: '1m', sublabel: 'Ultra Fast', value: 1 },
  { label: '5m', sublabel: 'Frequent', value: 5 },
  { label: '15m', sublabel: 'Standard', value: 15 },
  { label: '30m', sublabel: 'Balanced', value: 30 },
  { label: '1h', sublabel: 'Hourly', value: 60 },
  { label: '6h', sublabel: 'Extended', value: 360 },
];

const WINDOW_PRESETS = [
  { label: 'Night Owl', range: '00:00 – 06:00', start: '00:00', end: '06:00' },
  { label: 'Evening', range: '22:00 – 04:00', start: '22:00', end: '04:00' },
  { label: 'All Day', range: '00:00 – 23:59', start: '00:00', end: '23:59' },
];

const CONCURRENCY_PRESETS = [1, 2, 3, 5, 8];

function formatTimeDisplay(timeStr: string): string {
  try {
    const [hStr, mStr] = (timeStr || '00:00').split(':');
    const h = parseInt(hStr, 10) || 0;
    const m = parseInt(mStr, 10) || 0;
    const period = h >= 12 ? 'PM' : 'AM';
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${String(h12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${period} (${timeStr || '00:00'})`;
  } catch {
    return timeStr || '00:00';
  }
}

export default function SettingsScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  const [config, setConfig] = useState<AppConfig | null>(null);
  const [schedulerState, setSchedulerState] = useState<SchedulerState | null>(null);
  const [loading, setLoading] = useState(true);
  const [isTestingScheduler, setIsTestingScheduler] = useState(false);
  const [testResultText, setTestResultText] = useState<string | null>(null);
  const [dialerTarget, setDialerTarget] = useState<'start' | 'end' | null>(null);
  const [showFreeUpModal, setShowFreeUpModal] = useState(false);
  const [cleanableBytes, setCleanableBytes] = useState<number | null>(null);
  const [cleanableCount, setCleanableCount] = useState<number | null>(null);
  const [batteryLevel, setBatteryLevel] = useState<number | null>(null);
  const [isCharging, setIsCharging] = useState<boolean | null>(null);

  // Local state for time & concurrency
  const [timeStart, setTimeStart] = useState('00:00');
  const [timeEnd, setTimeEnd] = useState('06:00');
  const [concurrencyText, setConcurrencyText] = useState('3');

  const loadData = async () => {
    try {
      const [appConfig, state] = await Promise.all([getConfig(), getSchedulerState()]);
      setConfig(appConfig);
      setSchedulerState(state);
      setTimeStart(appConfig.timeWindowStart ?? '00:00');
      setTimeEnd(appConfig.timeWindowEnd ?? '06:00');
      setConcurrencyText(String(appConfig.concurrency ?? 3));

      // Query battery and storage analytics in parallel
      Battery.isAvailableAsync()
        .then(async (avail) => {
          if (!avail) return;
          const [level, bState] = await Promise.all([
            Battery.getBatteryLevelAsync().catch(() => -1),
            Battery.getBatteryStateAsync().catch(() => Battery.BatteryState.UNKNOWN),
          ]);
          if (level >= 0) setBatteryLevel(Math.round(level * 100));
          setIsCharging(
            bState === Battery.BatteryState.CHARGING || bState === Battery.BatteryState.FULL
          );
        })
        .catch(() => {});

      analyzeCleanableSpace()
        .then((analysis) => {
          setCleanableBytes(analysis.totalBytes);
          setCleanableCount(analysis.totalCount);
        })
        .catch(() => {});
    } catch (error) {
      console.error('Settings loadData error:', error);
    } finally {
      setLoading(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [])
  );

  useEffect(() => {
    const unsubscribe = schedulerEngine.subscribe((updatedState) => {
      setSchedulerState(updatedState);
    });
    return () => unsubscribe();
  }, []);

  const updateConfig = async (updates: Partial<AppConfig>) => {
    try {
      const updated = await saveConfig(updates);
      setConfig(updated);

      if (updates.autoUploadEnabled !== undefined) {
        if (updates.autoUploadEnabled) {
          await registerBackgroundUploadTask(updated.intervalMinutes);
        } else {
          await unregisterBackgroundUploadTask();
        }
      } else if (updates.intervalMinutes !== undefined && updated.autoUploadEnabled) {
        await registerBackgroundUploadTask(updates.intervalMinutes);
      }
    } catch (err) {
      console.warn('Failed to update config:', err);
    }
  };

  const handleRunSchedulerNow = async () => {
    if (isTestingScheduler) return;
    setIsTestingScheduler(true);
    setTestResultText(null);

    try {
      const result = await schedulerEngine.executeScheduler({
        forceManual: true,
        triggerSource: 'manual',
      });

      if (result.status === 'success' || result.status === 'partial') {
        const msg =
          result.uploadedCount > 0
            ? `Success! Backed up ${result.uploadedCount} file(s) in ${(result.durationMs / 1000).toFixed(1)}s.`
            : result.queuedFiles > 0
            ? `Queued ${result.queuedFiles} new file(s) for upload.`
            : 'Scheduler ran successfully: No new files found to backup.';
        setTestResultText(msg);
      } else if (result.status === 'skipped') {
        setTestResultText(`Skipped: ${result.reason || 'Conditions not met'}`);
      } else {
        setTestResultText(`Failed: ${result.error || 'Execution encountered an error'}`);
      }
      const refreshedState = await getSchedulerState();
      setSchedulerState(refreshedState);
    } catch (err: any) {
      setTestResultText(`Error: ${err?.message || 'Failed to trigger scheduler'}`);
    } finally {
      setIsTestingScheduler(false);
    }
  };

  const handleLogout = () => {
    Alert.alert(
      'Logout from Telegram',
      'Are you sure you want to disconnect your Telegram account? You will need to log in again to upload files.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Logout',
          style: 'destructive',
          onPress: async () => {
            try {
              await tdLibClient.disconnect();
              await SecureStoreLib.clearSession();
              router.replace('/telegram-login');
            } catch (err) {
              console.warn('Logout error:', err);
              router.replace('/telegram-login');
            }
          },
        },
      ]
    );
  };

  const requestPermissions = async () => {
    const granted = await requestMediaPermissions();
    if (granted) {
      Alert.alert('Permission Granted', 'Media and storage access is enabled.');
    } else {
      Alert.alert('Permission Denied', 'Please enable media access in your device settings.');
    }
  };

  if (loading || !config) {
    return (
      <SafeAreaView style={[styles.container, isDark && styles.containerDark]}>
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#208AEF" />
          <Text style={[styles.loadingText, isDark && styles.textDarkSecondary]}>
            Loading settings...
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const scheduleMode: ScheduleMode = config.scheduleMode || 'interval';
  const currentInterval = config.intervalMinutes ?? 1;
  const nextRunInfo = calculateNextEstimatedRun(config, schedulerState?.lastRunAt);

  // Status Badge calculation
  let statusBadgeColor = '#10B981';
  let statusBadgeBg = '#ECFDF5';
  let statusBadgeText = 'Active';

  if (!config.autoUploadEnabled) {
    statusBadgeColor = '#9CA3AF';
    statusBadgeBg = '#F3F4F6';
    statusBadgeText = 'Disabled';
  } else if (isTestingScheduler || schedulerState?.lastRunStatus === 'running') {
    statusBadgeColor = '#2563EB';
    statusBadgeBg = '#EFF6FF';
    statusBadgeText = 'Running Now';
  } else if (schedulerState?.lastRunStatus === 'skipped') {
    statusBadgeColor = '#F59E0B';
    statusBadgeBg = '#FFFBEB';
    statusBadgeText = schedulerState.lastSkipReason ? 'Waiting' : 'Idle';
  } else if (schedulerState?.lastRunStatus === 'failed') {
    statusBadgeColor = '#EF4444';
    statusBadgeBg = '#FEF2F2';
    statusBadgeText = 'Issue Detected';
  }

  return (
    <SafeAreaView style={[styles.container, isDark && styles.containerDark]} edges={['bottom', 'left', 'right']}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Profile / App Header Banner */}
        <View style={[styles.profileHeaderCard, isDark && styles.cardDark]}>
          <Image source={require('@/assets/images/app-logo.png')} style={styles.headerLogo} />
          <View style={styles.headerInfo}>
            <Text style={[styles.headerTitle, isDark && styles.textDarkPrimary]}>Nimo Save Storage</Text>
            <Text style={[styles.headerSubtitle, isDark && styles.textDarkSecondary]}>
              Auto-Backup Cloud Engine • v1.0.0
            </Text>
          </View>
        </View>

        {/* SECTION 1: DESTINATION SELECTOR */}
        <View style={styles.sectionContainer}>
          <View style={styles.sectionHeaderRow}>
            <View style={[styles.sectionIconBadge, { backgroundColor: '#EFF6FF' }]}>
              <FontAwesome name="telegram" size={14} color="#208AEF" />
            </View>
            <Text style={[styles.sectionHeading, isDark && styles.textDarkPrimary]}>Telegram Destination</Text>
          </View>
          <DestinationSelector />
        </View>

        {/* DEVICE STORAGE CLEANER */}
        <View style={styles.sectionContainer}>
          <View style={styles.sectionHeaderRow}>
            <View style={[styles.sectionIconBadge, { backgroundColor: '#ECFDF5' }]}>
              <FontAwesome name="recycle" size={14} color="#10B981" />
            </View>
            <Text style={[styles.sectionHeading, isDark && styles.textDarkPrimary]}>Device Storage Cleaner</Text>
            {cleanableBytes !== null && cleanableBytes > 0 && (
              <View style={[styles.statusBadge, { backgroundColor: '#ECFDF5', borderColor: '#10B98140' }]}>
                <Text style={[styles.statusBadgeText, { color: '#059669' }]}>
                  {formatFileSize(cleanableBytes)} ({cleanableCount || 0} files) Freeable
                </Text>
              </View>
            )}
          </View>

          <View style={[styles.card, isDark && styles.cardDark]}>
            <View style={styles.cleanerPromoRow}>
              <View style={styles.cleanerPromoInfo}>
                <Text style={[styles.rowTitleBold, isDark && styles.textDarkPrimary]}>
                  Free Up Phone Storage
                </Text>
                <Text style={[styles.rowSubtitle, isDark && styles.textDarkSecondary]}>
                  Safely remove local photos & videos already preserved in Telegram cloud
                </Text>
              </View>
              <TouchableOpacity
                style={styles.cleanActionBtn}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                  setShowFreeUpModal(true);
                }}
                activeOpacity={0.8}
              >
                <FontAwesome name="trash" size={13} color="#FFFFFF" style={{ marginRight: 6 }} />
                <Text style={styles.cleanActionBtnText}>Analyze & Clean</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* SECTION 2: AUTOMATED SCHEDULER */}
        <View style={styles.sectionContainer}>
          <View style={styles.sectionHeaderRow}>
            <View style={[styles.sectionIconBadge, { backgroundColor: '#F5F3FF' }]}>
              <FontAwesome name="calendar-check-o" size={14} color="#7C3AED" />
            </View>
            <Text style={[styles.sectionHeading, isDark && styles.textDarkPrimary]}>Auto Upload Scheduler</Text>
            <View style={[styles.statusBadge, { backgroundColor: statusBadgeBg, borderColor: statusBadgeColor + '40' }]}>
              <View style={[styles.statusDot, { backgroundColor: statusBadgeColor }]} />
              <Text style={[styles.statusBadgeText, { color: statusBadgeColor }]}>{statusBadgeText}</Text>
            </View>
          </View>

          <View style={[styles.card, isDark && styles.cardDark]}>
            {/* Auto Upload Master Switch */}
            <View style={styles.rowBetween}>
              <View style={styles.rowTextCol}>
                <Text style={[styles.rowTitleBold, isDark && styles.textDarkPrimary]}>Automated Upload</Text>
                <Text style={[styles.rowSubtitle, isDark && styles.textDarkSecondary]}>
                  Continuously monitor and sync new media files
                </Text>
              </View>
              <Switch
                value={config.autoUploadEnabled}
                onValueChange={(val) => updateConfig({ autoUploadEnabled: val })}
                trackColor={{ false: '#E2E8F0', true: '#93C5FD' }}
                thumbColor={config.autoUploadEnabled ? '#208AEF' : '#F8FAFC'}
              />
            </View>

            {/* Scheduler Status Summary Metric Box */}
            <View style={[styles.metricDashboardBox, isDark && styles.metricDashboardBoxDark]}>
              <View style={styles.metricItem}>
                <View style={styles.metricIconWrap}>
                  <FontAwesome name="hourglass-half" size={12} color="#208AEF" />
                </View>
                <View style={styles.metricContent}>
                  <Text style={styles.metricLabel}>Next Estimated Run</Text>
                  <Text style={[styles.metricValue, isDark && styles.textDarkPrimary]}>
                    {config.autoUploadEnabled ? nextRunInfo.humanText : 'Paused (Disabled)'}
                  </Text>
                </View>
              </View>

              <View style={styles.metricDivider} />

              <View style={styles.metricItem}>
                <View style={styles.metricIconWrap}>
                  <FontAwesome name="history" size={12} color="#10B981" />
                </View>
                <View style={styles.metricContent}>
                  <Text style={styles.metricLabel}>Last Backup Status</Text>
                  <Text style={[styles.metricValue, isDark && styles.textDarkPrimary]} numberOfLines={1}>
                    {schedulerState?.lastRunSummary || 'No runs recorded'}
                  </Text>
                </View>
              </View>

              {schedulerState?.lastSkipReason ? (
                <>
                  <View style={styles.metricDivider} />
                  <View style={styles.metricItem}>
                    <View style={styles.metricIconWrap}>
                      <FontAwesome name="info-circle" size={12} color="#F59E0B" />
                    </View>
                    <View style={styles.metricContent}>
                      <Text style={styles.metricLabel}>Scheduler Notice</Text>
                      <Text style={[styles.metricValue, { color: '#D97706' }]} numberOfLines={2}>
                        {schedulerState.lastSkipReason}
                      </Text>
                    </View>
                  </View>
                </>
              ) : null}
            </View>

            {/* Run Scheduler Test Button */}
            <TouchableOpacity
              style={[styles.testRunBtn, isTestingScheduler && styles.btnDisabled]}
              onPress={handleRunSchedulerNow}
              disabled={isTestingScheduler}
              activeOpacity={0.8}
            >
              {isTestingScheduler ? (
                <View style={styles.btnRowCenter}>
                  <ActivityIndicator size="small" color="#FFFFFF" style={{ marginRight: 8 }} />
                  <Text style={styles.testRunBtnText}>Executing scheduler test...</Text>
                </View>
              ) : (
                <View style={styles.btnRowCenter}>
                  <FontAwesome name="bolt" size={14} color="#FFFFFF" style={{ marginRight: 8 }} />
                  <Text style={styles.testRunBtnText}>Run Scheduler Now (Manual Test)</Text>
                </View>
              )}
            </TouchableOpacity>

            {testResultText && (
              <View style={styles.testResultBox}>
                <FontAwesome name="check-circle" size={14} color="#0369A1" style={{ marginRight: 6 }} />
                <Text style={styles.testResultText}>{testResultText}</Text>
              </View>
            )}

            <View style={styles.cardDivider} />

            {/* Schedule Mode Selector Tabs */}
            <Text style={[styles.sectionSubheading, isDark && styles.textDarkSecondary]}>Schedule Mode</Text>
            <View style={styles.segmentedTabContainer}>
              <TouchableOpacity
                style={[styles.segmentTab, scheduleMode === 'interval' && styles.segmentTabActive]}
                onPress={() => updateConfig({ scheduleMode: 'interval' })}
              >
                <FontAwesome
                  name="repeat"
                  size={12}
                  color={scheduleMode === 'interval' ? '#208AEF' : '#64748B'}
                  style={{ marginRight: 5 }}
                />
                <Text style={[styles.segmentTabText, scheduleMode === 'interval' && styles.segmentTabTextActive]}>
                  Interval
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.segmentTab, scheduleMode === 'window' && styles.segmentTabActive]}
                onPress={() => updateConfig({ scheduleMode: 'window' })}
              >
                <FontAwesome
                  name="moon-o"
                  size={12}
                  color={scheduleMode === 'window' ? '#208AEF' : '#64748B'}
                  style={{ marginRight: 5 }}
                />
                <Text style={[styles.segmentTabText, scheduleMode === 'window' && styles.segmentTabTextActive]}>
                  Night Window
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.segmentTab, scheduleMode === 'continuous' && styles.segmentTabActive]}
                onPress={() => updateConfig({ scheduleMode: 'continuous' })}
              >
                <FontAwesome
                  name="bolt"
                  size={12}
                  color={scheduleMode === 'continuous' ? '#208AEF' : '#64748B'}
                  style={{ marginRight: 5 }}
                />
                <Text style={[styles.segmentTabText, scheduleMode === 'continuous' && styles.segmentTabTextActive]}>
                  Continuous
                </Text>
              </TouchableOpacity>
            </View>

            {/* Mode-specific settings */}
            {scheduleMode === 'interval' && (
              <View style={styles.modeConfigCard}>
                <Text style={styles.modeConfigTitle}>Interval Frequency</Text>
                <Text style={styles.modeConfigSub}>
                  Select how often to check folders for new files. Minimum 1 minute supported.
                </Text>

                <View style={styles.chipsGrid}>
                  {INTERVAL_PRESETS.map((preset) => {
                    const isSelected = currentInterval === preset.value;
                    return (
                      <TouchableOpacity
                        key={preset.value}
                        style={[styles.intervalChip, isSelected && styles.intervalChipActive]}
                        onPress={() => updateConfig({ intervalMinutes: preset.value })}
                        activeOpacity={0.7}
                      >
                        <Text style={[styles.intervalChipTitle, isSelected && styles.intervalChipTitleActive]}>
                          {preset.label}
                        </Text>
                        <Text style={[styles.intervalChipSub, isSelected && styles.intervalChipSubActive]}>
                          {preset.sublabel}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            )}

            {scheduleMode === 'window' && (
              <View style={styles.modeConfigCard}>
                <Text style={styles.modeConfigTitle}>Preset Windows</Text>
                <View style={styles.chipsContainer}>
                  {WINDOW_PRESETS.map((p) => {
                    const isSelected = timeStart === p.start && timeEnd === p.end;
                    return (
                      <TouchableOpacity
                        key={p.label}
                        style={[styles.presetChip, isSelected && styles.presetChipActive]}
                        onPress={() => {
                          setTimeStart(p.start);
                          setTimeEnd(p.end);
                          updateConfig({ timeWindowStart: p.start, timeWindowEnd: p.end });
                        }}
                        activeOpacity={0.7}
                      >
                        <Text style={[styles.presetChipText, isSelected && styles.presetChipTextActive]}>
                          {p.label} ({p.start}–{p.end})
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* Clock Dialer Row: Start Time */}
                <TouchableOpacity
                  style={styles.dialerRowCard}
                  onPress={() => setDialerTarget('start')}
                  activeOpacity={0.7}
                >
                  <View style={styles.dialerRowInfo}>
                    <View style={styles.dialerIconBubble}>
                      <FontAwesome name="clock-o" size={14} color="#208AEF" />
                    </View>
                    <View>
                      <Text style={styles.dialerTitle}>Custom Start Time</Text>
                      <Text style={styles.dialerSub}>Tap to open Material clock dialer</Text>
                    </View>
                  </View>
                  <View style={styles.dialerBadgePill}>
                    <Text style={styles.dialerBadgeText}>{formatTimeDisplay(timeStart)}</Text>
                    <FontAwesome name="chevron-right" size={10} color="#208AEF" style={{ marginLeft: 6 }} />
                  </View>
                </TouchableOpacity>

                {/* Clock Dialer Row: End Time */}
                <TouchableOpacity
                  style={styles.dialerRowCard}
                  onPress={() => setDialerTarget('end')}
                  activeOpacity={0.7}
                >
                  <View style={styles.dialerRowInfo}>
                    <View style={styles.dialerIconBubble}>
                      <FontAwesome name="moon-o" size={14} color="#7C3AED" />
                    </View>
                    <View>
                      <Text style={styles.dialerTitle}>Custom End Time</Text>
                      <Text style={styles.dialerSub}>Supports midnight-spanning windows</Text>
                    </View>
                  </View>
                  <View style={styles.dialerBadgePill}>
                    <Text style={styles.dialerBadgeText}>{formatTimeDisplay(timeEnd)}</Text>
                    <FontAwesome name="chevron-right" size={10} color="#208AEF" style={{ marginLeft: 6 }} />
                  </View>
                </TouchableOpacity>
              </View>
            )}

            {scheduleMode === 'continuous' && (
              <View style={styles.modeConfigCard}>
                <View style={styles.rowAligned}>
                  <FontAwesome name="bolt" size={15} color="#F59E0B" style={{ marginRight: 8 }} />
                  <Text style={[styles.modeConfigTitle, { marginBottom: 0 }]}>Continuous Live Sync</Text>
                </View>
                <Text style={[styles.modeConfigSub, { marginTop: 6 }]}>
                  Monitors filesystem events and backs up newly captured photos and files immediately whenever the app is open.
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* SECTION 3: NETWORK & NOTIFICATION CONDITIONS */}
        <View style={styles.sectionContainer}>
          <View style={styles.sectionHeaderRow}>
            <View style={[styles.sectionIconBadge, { backgroundColor: '#ECFDF5' }]}>
              <FontAwesome name="wifi" size={13} color="#10B981" />
            </View>
            <Text style={[styles.sectionHeading, isDark && styles.textDarkPrimary]}>Network & Conditions</Text>
          </View>

          <View style={[styles.card, isDark && styles.cardDark]}>
            <View style={styles.rowBetween}>
              <View style={styles.rowTextCol}>
                <Text style={[styles.rowTitleBold, isDark && styles.textDarkPrimary]}>WiFi Only Backup</Text>
                <Text style={[styles.rowSubtitle, isDark && styles.textDarkSecondary]}>
                  Avoid cellular data usage; wait for an active WiFi connection
                </Text>
              </View>
              <Switch
                value={config.wifiOnly}
                onValueChange={(val) => updateConfig({ wifiOnly: val })}
                trackColor={{ false: '#E2E8F0', true: '#93C5FD' }}
                thumbColor={config.wifiOnly ? '#208AEF' : '#F8FAFC'}
              />
            </View>

            <View style={styles.cardDivider} />

            <View style={styles.rowBetween}>
              <View style={styles.rowTextCol}>
                <Text style={[styles.rowTitleBold, isDark && styles.textDarkPrimary]}>Notify on Backup Complete</Text>
                <Text style={[styles.rowSubtitle, isDark && styles.textDarkSecondary]}>
                  Receive a local notification summary when files are uploaded
                </Text>
              </View>
              <Switch
                value={config.notifyOnComplete ?? false}
                onValueChange={(val) => updateConfig({ notifyOnComplete: val })}
                trackColor={{ false: '#E2E8F0', true: '#93C5FD' }}
                thumbColor={config.notifyOnComplete ? '#208AEF' : '#F8FAFC'}
              />
            </View>

            <View style={styles.cardDivider} />

            <View style={styles.rowBetween}>
              <View style={styles.rowTextCol}>
                <View style={styles.rowAligned}>
                  <Text style={[styles.rowTitleBold, isDark && styles.textDarkPrimary]}>Only When Charging</Text>
                  {isCharging !== null && (
                    <View style={[styles.pillBadge, { backgroundColor: isCharging ? '#ECFDF5' : '#FEF3C7', marginLeft: 8 }]}>
                      <FontAwesome
                        name={isCharging ? 'bolt' : 'battery-three-quarters'}
                        size={10}
                        color={isCharging ? '#10B981' : '#D97706'}
                      />
                      <Text style={[styles.pillBadgeText, { color: isCharging ? '#059669' : '#D97706', marginLeft: 4 }]}>
                        {isCharging ? 'Charging' : 'On Battery'}
                      </Text>
                    </View>
                  )}
                </View>
                <Text style={[styles.rowSubtitle, isDark && styles.textDarkSecondary]}>
                  Only run background backups when connected to AC or USB power
                </Text>
              </View>
              <Switch
                value={config.onlyWhenCharging ?? false}
                onValueChange={(val) => {
                  Haptics.selectionAsync().catch(() => {});
                  updateConfig({ onlyWhenCharging: val });
                }}
                trackColor={{ false: '#E2E8F0', true: '#93C5FD' }}
                thumbColor={config.onlyWhenCharging ? '#208AEF' : '#F8FAFC'}
              />
            </View>

            <View style={styles.cardDivider} />

            <View style={styles.rowBetween}>
              <View style={styles.rowTextCol}>
                <View style={styles.rowAligned}>
                  <Text style={[styles.rowTitleBold, isDark && styles.textDarkPrimary]}>Battery Guard</Text>
                  {batteryLevel !== null && (
                    <View style={[styles.pillBadge, { backgroundColor: '#EFF6FF', marginLeft: 8 }]}>
                      <FontAwesome name="battery-half" size={10} color="#208AEF" />
                      <Text style={[styles.pillBadgeText, { color: '#208AEF', marginLeft: 4 }]}>
                        {batteryLevel}%
                      </Text>
                    </View>
                  )}
                </View>
                <Text style={[styles.rowSubtitle, isDark && styles.textDarkSecondary]}>
                  Automatically pause auto-backups when battery drops below threshold
                </Text>
              </View>
              <Switch
                value={config.batteryGuard ?? true}
                onValueChange={(val) => {
                  Haptics.selectionAsync().catch(() => {});
                  updateConfig({ batteryGuard: val });
                }}
                trackColor={{ false: '#E2E8F0', true: '#93C5FD' }}
                thumbColor={config.batteryGuard ? '#208AEF' : '#F8FAFC'}
              />
            </View>

            {config.batteryGuard && (
              <View style={styles.thresholdChipsRow}>
                <Text style={[styles.thresholdLabel, isDark && styles.textDarkSecondary]}>
                  Pause when below:
                </Text>
                {[15, 20, 30].map((pct) => {
                  const isSelected = (config.batteryGuardThreshold ?? 20) === pct;
                  return (
                    <TouchableOpacity
                      key={pct}
                      style={[styles.thresholdChip, isSelected && styles.thresholdChipActive]}
                      onPress={() => {
                        Haptics.selectionAsync().catch(() => {});
                        updateConfig({ batteryGuardThreshold: pct });
                      }}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.thresholdChipText, isSelected && styles.thresholdChipTextActive]}>
                        {pct}%
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            <View style={styles.cardDivider} />

            <View style={styles.rowBetween}>
              <View style={styles.rowTextCol}>
                <Text style={[styles.rowTitleBold, isDark && styles.textDarkPrimary]}>Upload to Saved Messages</Text>
                <Text style={[styles.rowSubtitle, isDark && styles.textDarkSecondary]}>
                  Store backups in your private Telegram cloud storage
                </Text>
              </View>
              <Switch
                value={config.uploadToSavedMessages}
                onValueChange={(val) => updateConfig({ uploadToSavedMessages: val })}
                trackColor={{ false: '#E2E8F0', true: '#93C5FD' }}
                thumbColor={config.uploadToSavedMessages ? '#208AEF' : '#F8FAFC'}
              />
            </View>
          </View>
        </View>

        {/* SECTION: SMART FILE FILTERS */}
        <View style={styles.sectionContainer}>
          <View style={styles.sectionHeaderRow}>
            <View style={[styles.sectionIconBadge, { backgroundColor: '#EEF2FF' }]}>
              <FontAwesome name="filter" size={13} color="#4F46E5" />
            </View>
            <Text style={[styles.sectionHeading, isDark && styles.textDarkPrimary]}>Smart File Filters</Text>
          </View>

          <View style={[styles.card, isDark && styles.cardDark]}>
            {/* Min File Size */}
            <View>
              <Text style={[styles.filterTitle, isDark && styles.textDarkPrimary]}>Minimum File Size</Text>
              <Text style={[styles.filterSubtitle, isDark && styles.textDarkSecondary]}>
                Skip app icons, cache thumbnails, and tiny stickers
              </Text>
              <View style={styles.chipsContainer}>
                {[
                  { label: 'None', val: 0 },
                  { label: '50 KB', val: 50 },
                  { label: '100 KB', val: 100 },
                  { label: '500 KB', val: 500 },
                  { label: '1 MB', val: 1024 },
                ].map((item) => {
                  const isSelected = (config.minFileSizeKb || 0) === item.val;
                  return (
                    <TouchableOpacity
                      key={item.label}
                      style={[styles.filterChip, isSelected && styles.filterChipActive]}
                      onPress={() => {
                        Haptics.selectionAsync().catch(() => {});
                        updateConfig({ minFileSizeKb: item.val });
                      }}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.filterChipText, isSelected && styles.filterChipTextActive]}>
                        {item.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            <View style={styles.cardDivider} />

            {/* Max File Size */}
            <View>
              <Text style={[styles.filterTitle, isDark && styles.textDarkPrimary]}>Maximum File Size</Text>
              <Text style={[styles.filterSubtitle, isDark && styles.textDarkSecondary]}>
                Skip oversized archives and ISO disk images (Telegram limit: 2 GB)
              </Text>
              <View style={styles.chipsContainer}>
                {[
                  { label: 'Unlimited (2 GB)', val: 0 },
                  { label: '500 MB', val: 500 * 1024 * 1024 },
                  { label: '1 GB', val: 1024 * 1024 * 1024 },
                  { label: '1.5 GB', val: 1536 * 1024 * 1024 },
                ].map((item) => {
                  const isSelected = (config.maxFileSizeBytes || 0) === item.val;
                  return (
                    <TouchableOpacity
                      key={item.label}
                      style={[styles.filterChip, isSelected && styles.filterChipActive]}
                      onPress={() => {
                        Haptics.selectionAsync().catch(() => {});
                        updateConfig({ maxFileSizeBytes: item.val });
                      }}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.filterChipText, isSelected && styles.filterChipTextActive]}>
                        {item.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            <View style={styles.cardDivider} />

            {/* Excluded Extensions */}
            <View>
              <Text style={[styles.filterTitle, isDark && styles.textDarkPrimary]}>Ignored File Extensions</Text>
              <Text style={[styles.filterSubtitle, isDark && styles.textDarkSecondary]}>
                System files and temp logs automatically skipped during scans
              </Text>
              <View style={styles.tagsContainer}>
                {(config.excludedExtensions || ['nomedia', 'tmp', 'log', 'thumb', 'bak']).map((ext) => (
                  <View key={ext} style={[styles.tagBadge, isDark && styles.tagBadgeDark]}>
                    <Text style={styles.tagBadgeDot}>•</Text>
                    <Text style={[styles.tagBadgeText, isDark && styles.textDarkPrimary]}>.{ext}</Text>
                  </View>
                ))}
              </View>
            </View>
          </View>
        </View>

        {/* SECTION 4: TRANSFER PERFORMANCE */}
        <View style={styles.sectionContainer}>
          <View style={styles.sectionHeaderRow}>
            <View style={[styles.sectionIconBadge, { backgroundColor: '#FEF3C7' }]}>
              <FontAwesome name="sliders" size={14} color="#D97706" />
            </View>
            <Text style={[styles.sectionHeading, isDark && styles.textDarkPrimary]}>Transfer Performance</Text>
          </View>

          <View style={[styles.card, isDark && styles.cardDark]}>
            <View style={styles.rowBetween}>
              <View style={styles.rowTextCol}>
                <Text style={[styles.rowTitleBold, isDark && styles.textDarkPrimary]}>Upload Concurrency</Text>
                <Text style={[styles.rowSubtitle, isDark && styles.textDarkSecondary]}>
                  Parallel chunks/files uploading simultaneously (like IDM)
                </Text>
              </View>
              <View style={styles.concurrencyInputWrap}>
                <TextInput
                  style={[styles.concurrencyInput, isDark && styles.inputDark]}
                  value={concurrencyText}
                  onChangeText={setConcurrencyText}
                  onBlur={() => {
                    const parsed = parseInt(concurrencyText, 10);
                    const clamped = Math.max(1, Math.min(10, parsed || 3));
                    setConcurrencyText(String(clamped));
                    updateConfig({ concurrency: clamped });
                  }}
                  keyboardType="numeric"
                  maxLength={2}
                />
              </View>
            </View>

            <View style={styles.concurrencyPresetsRow}>
              {CONCURRENCY_PRESETS.map((count) => {
                const isSelected = (config.concurrency || 3) === count;
                return (
                  <TouchableOpacity
                    key={count}
                    style={[styles.concurrencyPill, isSelected && styles.concurrencyPillActive]}
                    onPress={() => {
                      setConcurrencyText(String(count));
                      updateConfig({ concurrency: count });
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.concurrencyPillText, isSelected && styles.concurrencyPillTextActive]}>
                      {count} {count === 1 ? 'file' : 'parallel'}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </View>

        {/* SECTION 5: PERMISSIONS */}
        <View style={styles.sectionContainer}>
          <View style={styles.sectionHeaderRow}>
            <View style={[styles.sectionIconBadge, { backgroundColor: '#F1F5F9' }]}>
              <FontAwesome name="shield" size={14} color="#475569" />
            </View>
            <Text style={[styles.sectionHeading, isDark && styles.textDarkPrimary]}>Device Permissions</Text>
          </View>

          <View style={[styles.card, isDark && styles.cardDark]}>
            <View style={styles.rowBetween}>
              <View style={styles.rowTextCol}>
                <Text style={[styles.rowTitleBold, isDark && styles.textDarkPrimary]}>Media & Storage Access</Text>
                <Text style={[styles.rowSubtitle, isDark && styles.textDarkSecondary]}>
                  Allows scanning photo galleries, videos, and SAF folders
                </Text>
              </View>
              <TouchableOpacity style={styles.permissionBtn} onPress={requestPermissions} activeOpacity={0.8}>
                <FontAwesome name="check-circle" size={13} color="#208AEF" style={{ marginRight: 6 }} />
                <Text style={styles.permissionBtnText}>Grant / Verify</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* SECTION 6: SECURITY & PRIVACY */}
        <View style={styles.sectionContainer}>
          <View style={styles.sectionHeaderRow}>
            <View style={[styles.sectionIconBadge, { backgroundColor: '#F0FDF4' }]}>
              <FontAwesome name="lock" size={14} color="#16A34A" />
            </View>
            <Text style={[styles.sectionHeading, isDark && styles.textDarkPrimary]}>Security & Privacy</Text>
          </View>

          <View style={[styles.card, isDark && styles.cardDark]}>
            <View style={styles.rowBetween}>
              <View style={styles.rowTextCol}>
                <Text style={[styles.rowTitleBold, isDark && styles.textDarkPrimary]}>Biometric App Lock</Text>
                <Text style={[styles.rowSubtitle, isDark && styles.textDarkSecondary]}>
                  Require fingerprint, Face ID, or passcode to open app
                </Text>
              </View>
              <Switch
                value={config.biometricLockEnabled ?? false}
                onValueChange={async (val) => {
                  Haptics.selectionAsync().catch(() => {});
                  if (val) {
                    try {
                      const res = await LocalAuthentication.authenticateAsync({
                        promptMessage: 'Verify identity to enable App Lock',
                      });
                      if (res.success) {
                        updateConfig({ biometricLockEnabled: true });
                      } else {
                        Alert.alert('Authentication Failed', 'Unable to verify biometric identity.');
                      }
                    } catch (err: any) {
                      Alert.alert('Biometric Error', err?.message || 'Biometric hardware unavailable.');
                    }
                  } else {
                    updateConfig({ biometricLockEnabled: false });
                  }
                }}
                trackColor={{ false: '#E2E8F0', true: '#93C5FD' }}
                thumbColor={config.biometricLockEnabled ? '#208AEF' : '#F8FAFC'}
              />
            </View>

            {config.biometricLockEnabled && (
              <>
                <View style={styles.cardDivider} />
                <View>
                  <Text style={[styles.filterTitle, isDark && styles.textDarkPrimary]}>Auto-Lock Timeout</Text>
                  <Text style={[styles.filterSubtitle, isDark && styles.textDarkSecondary]}>
                    Lock app when backgrounded or inactive
                  </Text>
                  <View style={styles.chipsContainer}>
                    {[
                      { label: 'Immediately', val: 0 },
                      { label: '1 Minute', val: 60 },
                      { label: '5 Minutes', val: 300 },
                    ].map((item) => {
                      const isSelected = (config.biometricLockTimeout ?? 0) === item.val;
                      return (
                        <TouchableOpacity
                          key={item.label}
                          style={[styles.filterChip, isSelected && styles.filterChipActive]}
                          onPress={() => {
                            Haptics.selectionAsync().catch(() => {});
                            updateConfig({ biometricLockTimeout: item.val });
                          }}
                          activeOpacity={0.7}
                        >
                          <Text style={[styles.filterChipText, isSelected && styles.filterChipTextActive]}>
                            {item.label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              </>
            )}
          </View>
        </View>

        {/* SECTION 7: DIAGNOSTICS & ACCOUNT ACTIONS */}
        <View style={styles.sectionContainer}>
          <View style={styles.sectionHeaderRow}>
            <View style={[styles.sectionIconBadge, { backgroundColor: '#F1F5F9' }]}>
              <FontAwesome name="wrench" size={14} color="#475569" />
            </View>
            <Text style={[styles.sectionHeading, isDark && styles.textDarkPrimary]}>Diagnostics & Session</Text>
          </View>

          <View style={[styles.card, isDark && styles.cardDark, { padding: 6 }]}>
            {/* View Debug Logs Action Row */}
            <TouchableOpacity
              style={styles.menuActionRow}
              onPress={() => router.push('/logs')}
              activeOpacity={0.7}
            >
              <View style={styles.rowAligned}>
                <View style={[styles.menuIconBadge, { backgroundColor: '#EFF6FF' }]}>
                  <FontAwesome name="terminal" size={14} color="#208AEF" />
                </View>
                <View>
                  <Text style={[styles.menuRowTitle, isDark && styles.textDarkPrimary]}>View Debug Logs</Text>
                  <Text style={[styles.menuRowSub, isDark && styles.textDarkSecondary]}>
                    Inspect real-time TDLib events and worker console logs
                  </Text>
                </View>
              </View>
              <FontAwesome name="chevron-right" size={12} color="#94A3B8" />
            </TouchableOpacity>

            <View style={styles.cardDivider} />

            {/* Logout Action Row */}
            <TouchableOpacity
              style={styles.menuActionRow}
              onPress={handleLogout}
              activeOpacity={0.7}
            >
              <View style={styles.rowAligned}>
                <View style={[styles.menuIconBadge, { backgroundColor: '#FEF2F2' }]}>
                  <FontAwesome name="sign-out" size={14} color="#EF4444" />
                </View>
                <View>
                  <Text style={[styles.menuRowTitle, { color: '#EF4444' }]}>Logout from Telegram</Text>
                  <Text style={[styles.menuRowSub, isDark && styles.textDarkSecondary]}>
                    Disconnect active session and return to phone login
                  </Text>
                </View>
              </View>
              <FontAwesome name="chevron-right" size={12} color="#EF4444" />
            </TouchableOpacity>
          </View>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Clock Face Dialer Modal */}
      <TimeDialerModal
        visible={dialerTarget !== null}
        title={dialerTarget === 'start' ? 'Set Custom Start Time' : 'Set Custom End Time'}
        initialTime={dialerTarget === 'start' ? timeStart : timeEnd}
        onConfirm={(selectedTime) => {
          if (dialerTarget === 'start') {
            setTimeStart(selectedTime);
            updateConfig({ timeWindowStart: selectedTime });
          } else if (dialerTarget === 'end') {
            setTimeEnd(selectedTime);
            updateConfig({ timeWindowEnd: selectedTime });
          }
        }}
        onClose={() => setDialerTarget(null)}
      />

      {/* Free Up Device Space Modal */}
      <FreeUpSpaceModal
        visible={showFreeUpModal}
        onClose={() => setShowFreeUpModal(false)}
        onCleanComplete={() => {
          loadData();
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  containerDark: {
    backgroundColor: '#0F172A',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: '#64748B',
  },
  textDarkPrimary: {
    color: '#F8FAFC',
  },
  textDarkSecondary: {
    color: '#94A3B8',
  },

  /* Profile Header */
  profileHeaderCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  headerLogo: {
    width: 44,
    height: 44,
    borderRadius: 10,
    marginRight: 12,
  },
  headerInfo: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0F172A',
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },

  /* Sections */
  sectionContainer: {
    marginBottom: 20,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    paddingHorizontal: 4,
  },
  sectionIconBadge: {
    width: 26,
    height: 26,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  sectionHeading: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1E293B',
    flex: 1,
  },
  sectionSubheading: {
    fontSize: 13,
    fontWeight: '600',
    color: '#475569',
    marginBottom: 8,
  },

  /* Status Badge */
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 12,
    borderWidth: 1,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 5,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },

  /* Cards */
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  cardDark: {
    backgroundColor: '#1E293B',
    borderColor: '#334155',
  },
  cardDivider: {
    height: 1,
    backgroundColor: '#F1F5F9',
    marginVertical: 14,
  },

  /* Rows */
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  rowAligned: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  rowTextCol: {
    flex: 1,
    marginRight: 12,
  },
  rowTitleBold: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0F172A',
  },
  rowSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
    lineHeight: 16,
  },

  /* Metric Dashboard Box */
  metricDashboardBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 12,
    marginVertical: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  metricDashboardBoxDark: {
    backgroundColor: '#0F172A',
    borderColor: '#334155',
  },
  metricItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  metricIconWrap: {
    width: 24,
    height: 24,
    borderRadius: 6,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  metricContent: {
    flex: 1,
  },
  metricLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748B',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  metricValue: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1E293B',
    marginTop: 1,
  },
  metricDivider: {
    height: 1,
    backgroundColor: '#E2E8F0',
    marginVertical: 8,
  },

  /* Test Run Button */
  testRunBtn: {
    backgroundColor: '#208AEF',
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#208AEF',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 2,
  },
  btnRowCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  testRunBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  btnDisabled: {
    opacity: 0.7,
  },
  testResultBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EFF6FF',
    borderRadius: 8,
    padding: 10,
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  testResultText: {
    fontSize: 12,
    color: '#0369A1',
    fontWeight: '500',
    flex: 1,
  },

  /* Segmented Controls */
  segmentedTabContainer: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    borderRadius: 10,
    padding: 3,
    marginBottom: 12,
  },
  segmentTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 8,
  },
  segmentTabActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 2,
  },
  segmentTabText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
  },
  segmentTabTextActive: {
    color: '#208AEF',
    fontWeight: '700',
  },

  /* Mode Config Cards */
  modeConfigCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  modeConfigTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1E293B',
    marginBottom: 2,
  },
  modeConfigSub: {
    fontSize: 11,
    color: '#64748B',
    marginBottom: 10,
    lineHeight: 15,
  },

  /* Chips */
  chipsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  intervalChip: {
    width: '31%',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  intervalChipActive: {
    backgroundColor: '#EFF6FF',
    borderColor: '#208AEF',
    borderWidth: 1.5,
  },
  intervalChipTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#334155',
  },
  intervalChipTitleActive: {
    color: '#208AEF',
  },
  intervalChipSub: {
    fontSize: 10,
    color: '#94A3B8',
    marginTop: 1,
  },
  intervalChipSubActive: {
    color: '#208AEF',
    fontWeight: '600',
  },

  chipsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 10,
  },
  presetChip: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  presetChipActive: {
    backgroundColor: '#EFF6FF',
    borderColor: '#208AEF',
  },
  presetChipText: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '600',
  },
  presetChipTextActive: {
    color: '#208AEF',
    fontWeight: '700',
  },

  /* Dialer Rows */
  dialerRowCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 10,
    marginTop: 8,
  },
  dialerRowInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  dialerIconBubble: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  dialerTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1E293B',
  },
  dialerSub: {
    fontSize: 10,
    color: '#94A3B8',
    marginTop: 1,
  },
  dialerBadgePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EFF6FF',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  dialerBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#208AEF',
  },

  /* Concurrency */
  concurrencyInputWrap: {
    width: 50,
  },
  concurrencyInput: {
    backgroundColor: '#F1F5F9',
    borderRadius: 8,
    paddingVertical: 6,
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
    textAlign: 'center',
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  inputDark: {
    backgroundColor: '#334155',
    color: '#F8FAFC',
    borderColor: '#475569',
  },
  concurrencyPresetsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  concurrencyPill: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    paddingVertical: 6,
    alignItems: 'center',
    marginHorizontal: 2,
  },
  concurrencyPillActive: {
    backgroundColor: '#EFF6FF',
    borderColor: '#208AEF',
    borderWidth: 1.5,
  },
  concurrencyPillText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748B',
  },
  concurrencyPillTextActive: {
    color: '#208AEF',
    fontWeight: '700',
  },

  /* Permission Button */
  permissionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EFF6FF',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  permissionBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#208AEF',
  },

  /* Menu Action Rows (Logs, Logout) */
  menuActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 10,
    borderRadius: 10,
  },
  menuIconBadge: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  menuRowTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0F172A',
  },
  menuRowSub: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },

  /* Cleaner Promo */
  cleanerPromoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  cleanerPromoInfo: {
    flex: 1,
  },
  cleanActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#10B981',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  cleanActionBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },

  /* Pill Badges */
  pillBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  pillBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  thresholdChipsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
    paddingLeft: 4,
  },
  thresholdLabel: {
    fontSize: 12,
    color: '#64748B',
    marginRight: 4,
  },
  thresholdChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  thresholdChipActive: {
    backgroundColor: '#EFF6FF',
    borderColor: '#208AEF',
    borderWidth: 1.5,
  },
  thresholdChipText: {
    fontSize: 11,
    color: '#475569',
    fontWeight: '600',
  },
  thresholdChipTextActive: {
    color: '#208AEF',
    fontWeight: '700',
  },

  /* Filter chips and tags */
  filterTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1E293B',
    marginBottom: 2,
  },
  filterSubtitle: {
    fontSize: 11,
    color: '#64748B',
    marginBottom: 8,
  },
  filterChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  filterChipActive: {
    backgroundColor: '#EEF2FF',
    borderColor: '#4F46E5',
    borderWidth: 1.5,
  },
  filterChipText: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '600',
  },
  filterChipTextActive: {
    color: '#4F46E5',
    fontWeight: '700',
  },
  tagsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  tagBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  tagBadgeDark: {
    backgroundColor: '#334155',
  },
  tagBadgeDot: {
    color: '#6366F1',
    marginRight: 4,
    fontSize: 12,
  },
  tagBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#334155',
  },
});
