import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  Modal,
  StyleSheet,
  TouchableOpacity,
  useColorScheme,
} from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import * as Haptics from 'expo-haptics';

interface TimeDialerModalProps {
  visible: boolean;
  title: string;
  initialTime: string; // HH:mm (24-hour)
  onConfirm: (time: string) => void;
  onClose: () => void;
}

const DIAL_SIZE = 250;
const DIAL_RADIUS = 92;
const CENTER = DIAL_SIZE / 2;

const HOURS = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const MINUTES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

const QUICK_PRESETS = [
  { label: '10 PM', time: '22:00', icon: 'moon-o' as const },
  { label: '11 PM', time: '23:00', icon: 'moon-o' as const },
  { label: 'Midnight', time: '00:00', icon: 'star' as const },
  { label: '4 AM', time: '04:00', icon: 'clock-o' as const },
  { label: '6 AM', time: '06:00', icon: 'sun-o' as const },
  { label: '8 AM', time: '08:00', icon: 'sun-o' as const },
];

export function TimeDialerModal({
  visible,
  title,
  initialTime,
  onConfirm,
  onClose,
}: TimeDialerModalProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  const [mode, setMode] = useState<'hour' | 'minute'>('hour');
  const [selectedHour, setSelectedHour] = useState(12);
  const [selectedMinute, setSelectedMinute] = useState(0);
  const [period, setPeriod] = useState<'AM' | 'PM'>('AM');
  const advanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (advanceTimerRef.current) {
        clearTimeout(advanceTimerRef.current);
      }
    };
  }, []);

  // Parse initial 24h string (e.g. "22:30" or "06:00")
  useEffect(() => {
    if (visible && initialTime) {
      try {
        const [hStr, mStr] = initialTime.split(':');
        const h24 = parseInt(hStr, 10) || 0;
        const m = parseInt(mStr, 10) || 0;

        if (h24 === 0) {
          setSelectedHour(12);
          setPeriod('AM');
        } else if (h24 === 12) {
          setSelectedHour(12);
          setPeriod('PM');
        } else if (h24 > 12) {
          setSelectedHour(h24 - 12);
          setPeriod('PM');
        } else {
          setSelectedHour(h24);
          setPeriod('AM');
        }

        setSelectedMinute(m);
        setMode('hour');
      } catch {
        setSelectedHour(12);
        setSelectedMinute(0);
        setPeriod('AM');
      }
    }
  }, [visible, initialTime]);

  // Convert current 12-hour + AM/PM back to 24h "HH:mm"
  const getFormatted24h = () => {
    let h24 = selectedHour;
    if (period === 'AM') {
      h24 = selectedHour === 12 ? 0 : selectedHour;
    } else {
      h24 = selectedHour === 12 ? 12 : selectedHour + 12;
    }
    const hh = String(h24).padStart(2, '0');
    const mm = String(selectedMinute).padStart(2, '0');
    return `${hh}:${mm}`;
  };

  const handleHourSelect = (hour: number) => {
    Haptics.selectionAsync().catch(() => {});
    setSelectedHour(hour);
    // Auto-advance to minute mode after picking an hour
    if (advanceTimerRef.current) {
      clearTimeout(advanceTimerRef.current);
    }
    advanceTimerRef.current = setTimeout(() => {
      setMode('minute');
    }, 180);
  };

  const handleMinuteSelect = (min: number) => {
    Haptics.selectionAsync().catch(() => {});
    setSelectedMinute(min);
  };

  const adjustMinute = (delta: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setSelectedMinute((prev) => {
      let next = prev + delta;
      if (next >= 60) next = 0;
      if (next < 0) next = 59;
      return next;
    });
  };

  const applyQuickTime = (timeStr: string) => {
    Haptics.selectionAsync().catch(() => {});
    try {
      const [hStr, mStr] = timeStr.split(':');
      const h24 = parseInt(hStr, 10) || 0;
      const m = parseInt(mStr, 10) || 0;

      if (h24 === 0) {
        setSelectedHour(12);
        setPeriod('AM');
      } else if (h24 === 12) {
        setSelectedHour(12);
        setPeriod('PM');
      } else if (h24 > 12) {
        setSelectedHour(h24 - 12);
        setPeriod('PM');
      } else {
        setSelectedHour(h24);
        setPeriod('AM');
      }

      setSelectedMinute(m);
    } catch {}
  };

  const handleSave = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    onConfirm(getFormatted24h());
    onClose();
  };

  // Compute needle angle and coordinates
  let needleAngle = 0;
  if (mode === 'hour') {
    const idx = selectedHour === 12 ? 0 : selectedHour;
    needleAngle = idx * 30; // 360 / 12 = 30 deg
  } else {
    needleAngle = (selectedMinute / 60) * 360;
  }

  // Radians with 12 o'clock as 0 deg (-90 deg offset)
  const needleRad = ((needleAngle - 90) * Math.PI) / 180;
  const needleX = CENTER + DIAL_RADIUS * Math.cos(needleRad);
  const needleY = CENTER + DIAL_RADIUS * Math.sin(needleRad);

  const formatted24 = getFormatted24h();

  // Dynamic Theme Palette
  const cardBg = isDark ? '#1E293B' : '#FFFFFF';
  const cardBorder = isDark ? '#334155' : '#E2E8F0';
  const textPrimary = isDark ? '#F8FAFC' : '#0F172A';
  const textSecondary = isDark ? '#94A3B8' : '#64748B';
  const surfaceSubtle = isDark ? '#0F172A' : '#F1F5F9';
  const dialBg = isDark ? '#0B1120' : '#F8FAFC';
  const dialBorder = isDark ? '#334155' : '#E2E8F0';
  const dialText = isDark ? '#CBD5E1' : '#334155';
  const accent = '#208AEF';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={[styles.modalCard, { backgroundColor: cardBg, borderColor: cardBorder }]}>
          {/* Header */}
          <View style={styles.headerRow}>
            <View style={styles.headerTitleWrap}>
              <FontAwesome
                name={period === 'PM' || selectedHour >= 9 ? 'moon-o' : 'sun-o'}
                size={16}
                color={accent}
                style={{ marginRight: 8 }}
              />
              <Text style={[styles.modalTitle, { color: textPrimary }]}>{title}</Text>
            </View>
            <TouchableOpacity
              onPress={onClose}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={[styles.closeIconBtn, { backgroundColor: surfaceSubtle }]}
            >
              <FontAwesome name="times" size={13} color={textSecondary} />
            </TouchableOpacity>
          </View>

          {/* Quick Presets Carousel */}
          <View style={styles.presetsBar}>
            {QUICK_PRESETS.map((qp) => {
              const isMatch = qp.time === formatted24;
              return (
                <TouchableOpacity
                  key={qp.label}
                  style={[
                    styles.quickPill,
                    { backgroundColor: surfaceSubtle, borderColor: cardBorder },
                    isMatch && [styles.quickPillActive, { borderColor: accent }],
                  ]}
                  onPress={() => applyQuickTime(qp.time)}
                  activeOpacity={0.7}
                >
                  <FontAwesome
                    name={qp.icon}
                    size={9}
                    color={isMatch ? accent : textSecondary}
                    style={{ marginRight: 4 }}
                  />
                  <Text
                    style={[
                      styles.quickPillText,
                      { color: textSecondary },
                      isMatch && [styles.quickPillTextActive, { color: accent }],
                    ]}
                  >
                    {qp.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Digital Time Preview & Mode Selector */}
          <View style={styles.timeDisplayRow}>
            <View style={styles.timeNumbersContainer}>
              <TouchableOpacity
                style={[
                  styles.timeBox,
                  { backgroundColor: surfaceSubtle },
                  mode === 'hour' && [styles.timeBoxActive, { borderColor: accent, backgroundColor: isDark ? '#1E3A8A33' : '#EFF6FF' }],
                ]}
                onPress={() => {
                  Haptics.selectionAsync().catch(() => {});
                  setMode('hour');
                }}
              >
                <Text
                  style={[
                    styles.timeBoxText,
                    { color: textSecondary },
                    mode === 'hour' && [styles.timeBoxTextActive, { color: accent }],
                  ]}
                >
                  {String(selectedHour).padStart(2, '0')}
                </Text>
                <Text style={[styles.timeBoxLabel, { color: textSecondary }]}>HR</Text>
              </TouchableOpacity>

              <Text style={[styles.timeColon, { color: textSecondary }]}>:</Text>

              <TouchableOpacity
                style={[
                  styles.timeBox,
                  { backgroundColor: surfaceSubtle },
                  mode === 'minute' && [styles.timeBoxActive, { borderColor: accent, backgroundColor: isDark ? '#1E3A8A33' : '#EFF6FF' }],
                ]}
                onPress={() => {
                  Haptics.selectionAsync().catch(() => {});
                  setMode('minute');
                }}
              >
                <Text
                  style={[
                    styles.timeBoxText,
                    { color: textSecondary },
                    mode === 'minute' && [styles.timeBoxTextActive, { color: accent }],
                  ]}
                >
                  {String(selectedMinute).padStart(2, '0')}
                </Text>
                <Text style={[styles.timeBoxLabel, { color: textSecondary }]}>MIN</Text>
              </TouchableOpacity>
            </View>

            {/* AM / PM Toggle */}
            <View style={[styles.periodToggle, { backgroundColor: surfaceSubtle }]}>
              <TouchableOpacity
                style={[styles.periodBtn, period === 'AM' && [styles.periodBtnActive, { backgroundColor: accent }]]}
                onPress={() => {
                  Haptics.selectionAsync().catch(() => {});
                  setPeriod('AM');
                }}
              >
                <Text
                  style={[
                    styles.periodText,
                    { color: textSecondary },
                    period === 'AM' && styles.periodTextActive,
                  ]}
                >
                  AM
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.periodBtn, period === 'PM' && [styles.periodBtnActive, { backgroundColor: accent }]]}
                onPress={() => {
                  Haptics.selectionAsync().catch(() => {});
                  setPeriod('PM');
                }}
              >
                <Text
                  style={[
                    styles.periodText,
                    { color: textSecondary },
                    period === 'PM' && styles.periodTextActive,
                  ]}
                >
                  PM
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          <Text style={[styles.preview24h, { color: textSecondary }]}>
            24-hour equivalent: <Text style={{ fontWeight: '700', color: textPrimary }}>{formatted24}</Text>
          </Text>

          {/* Clock Face Dial */}
          <View style={styles.dialContainer}>
            <View style={[styles.dialFace, { backgroundColor: dialBg, borderColor: dialBorder }]}>
              {/* Dial Center Pivot */}
              <View style={[styles.dialCenterDot, { backgroundColor: accent }]} />

              {/* Needle Pointer Line */}
              <View
                style={[
                  styles.needleLine,
                  {
                    left: CENTER,
                    top: CENTER - 1,
                    width: DIAL_RADIUS,
                    backgroundColor: accent,
                    transform: [{ rotate: `${needleAngle - 90}deg` }],
                  },
                ]}
              />

              {/* Glowing Pointer Head */}
              <View
                style={[
                  styles.pointerHead,
                  {
                    left: needleX - 17,
                    top: needleY - 17,
                    backgroundColor: accent,
                  },
                ]}
              />

              {/* Hour or Minute Numbers */}
              {mode === 'hour'
                ? HOURS.map((h, i) => {
                    const angleDeg = i * 30 - 90;
                    const rad = (angleDeg * Math.PI) / 180;
                    const x = CENTER + DIAL_RADIUS * Math.cos(rad);
                    const y = CENTER + DIAL_RADIUS * Math.sin(rad);
                    const isSelected = selectedHour === h;

                    return (
                      <TouchableOpacity
                        key={`h-${h}`}
                        style={[styles.dialNumberItem, { left: x - 17, top: y - 17 }]}
                        onPress={() => handleHourSelect(h)}
                        activeOpacity={0.7}
                      >
                        <Text
                          style={[
                            styles.dialNumberText,
                            { color: dialText },
                            isSelected && styles.dialNumberTextSelected,
                          ]}
                        >
                          {h}
                        </Text>
                      </TouchableOpacity>
                    );
                  })
                : MINUTES.map((m, i) => {
                    const angleDeg = i * 30 - 90;
                    const rad = (angleDeg * Math.PI) / 180;
                    const x = CENTER + DIAL_RADIUS * Math.cos(rad);
                    const y = CENTER + DIAL_RADIUS * Math.sin(rad);
                    const isSelected = selectedMinute === m;

                    return (
                      <TouchableOpacity
                        key={`m-${m}`}
                        style={[styles.dialNumberItem, { left: x - 17, top: y - 17 }]}
                        onPress={() => handleMinuteSelect(m)}
                        activeOpacity={0.7}
                      >
                        <Text
                          style={[
                            styles.dialNumberText,
                            { color: dialText },
                            isSelected && styles.dialNumberTextSelected,
                          ]}
                        >
                          {String(m).padStart(2, '0')}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
            </View>
          </View>

          {/* Steppers for precise minutes */}
          <View style={styles.fineAdjustRow}>
            <TouchableOpacity
              style={[styles.stepperBtn, { backgroundColor: surfaceSubtle, borderColor: cardBorder }]}
              onPress={() => adjustMinute(-5)}
            >
              <Text style={[styles.stepperText, { color: textPrimary }]}>-5m</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.stepperBtn, { backgroundColor: surfaceSubtle, borderColor: cardBorder }]}
              onPress={() => adjustMinute(-1)}
            >
              <Text style={[styles.stepperText, { color: textPrimary }]}>-1m</Text>
            </TouchableOpacity>
            <View style={styles.fineAdjustCenter}>
              <FontAwesome name="sliders" size={10} color={textSecondary} style={{ marginRight: 4 }} />
              <Text style={[styles.fineAdjustLabel, { color: textSecondary }]}>Fine Tune</Text>
            </View>
            <TouchableOpacity
              style={[styles.stepperBtn, { backgroundColor: surfaceSubtle, borderColor: cardBorder }]}
              onPress={() => adjustMinute(1)}
            >
              <Text style={[styles.stepperText, { color: textPrimary }]}>+1m</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.stepperBtn, { backgroundColor: surfaceSubtle, borderColor: cardBorder }]}
              onPress={() => adjustMinute(5)}
            >
              <Text style={[styles.stepperText, { color: textPrimary }]}>+5m</Text>
            </TouchableOpacity>
          </View>

          {/* Action Buttons */}
          <View style={styles.modalActions}>
            <TouchableOpacity
              style={[styles.cancelBtn, { backgroundColor: surfaceSubtle }]}
              onPress={onClose}
              activeOpacity={0.7}
            >
              <Text style={[styles.cancelBtnText, { color: textSecondary }]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.confirmBtn, { backgroundColor: accent }]}
              onPress={handleSave}
              activeOpacity={0.85}
            >
              <FontAwesome name="check" size={13} color="#FFFFFF" style={{ marginRight: 6 }} />
              <Text style={styles.confirmBtnText}>Set Time</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalCard: {
    borderRadius: 24,
    padding: 20,
    width: '100%',
    maxWidth: 350,
    alignItems: 'center',
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 12,
  },
  headerRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  headerTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  closeIconBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  presetsBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    justifyContent: 'center',
    marginBottom: 14,
  },
  quickPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
  },
  quickPillActive: {
    backgroundColor: 'rgba(32, 138, 239, 0.12)',
  },
  quickPillText: {
    fontSize: 10,
    fontWeight: '600',
  },
  quickPillTextActive: {
    fontWeight: '700',
  },
  timeDisplayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
    gap: 12,
  },
  timeNumbersContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  timeBox: {
    paddingHorizontal: 12,
    paddingTop: 6,
    paddingBottom: 4,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  timeBoxActive: {},
  timeBoxText: {
    fontSize: 28,
    fontWeight: '800',
  },
  timeBoxTextActive: {},
  timeBoxLabel: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  timeColon: {
    fontSize: 26,
    fontWeight: '700',
    marginHorizontal: 4,
  },
  periodToggle: {
    borderRadius: 10,
    padding: 3,
  },
  periodBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 7,
  },
  periodBtnActive: {},
  periodText: {
    fontSize: 11,
    fontWeight: '700',
  },
  periodTextActive: {
    color: '#ffffff',
  },
  preview24h: {
    fontSize: 11,
    marginBottom: 10,
  },
  dialContainer: {
    width: DIAL_SIZE,
    height: DIAL_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  dialFace: {
    width: DIAL_SIZE,
    height: DIAL_SIZE,
    borderRadius: DIAL_SIZE / 2,
    borderWidth: 1,
    position: 'relative',
  },
  dialCenterDot: {
    position: 'absolute',
    left: CENTER - 4,
    top: CENTER - 4,
    width: 8,
    height: 8,
    borderRadius: 4,
    zIndex: 10,
  },
  needleLine: {
    position: 'absolute',
    height: 2,
    zIndex: 5,
    transformOrigin: 'left center' as any,
  },
  pointerHead: {
    position: 'absolute',
    width: 34,
    height: 34,
    borderRadius: 17,
    zIndex: 6,
  },
  dialNumberItem: {
    position: 'absolute',
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 8,
  },
  dialNumberText: {
    fontSize: 14,
    fontWeight: '600',
  },
  dialNumberTextSelected: {
    color: '#ffffff',
    fontWeight: '800',
  },
  fineAdjustRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginBottom: 14,
  },
  fineAdjustCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  fineAdjustLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  stepperBtn: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
  },
  stepperText: {
    fontSize: 11,
    fontWeight: '700',
  },
  modalActions: {
    flexDirection: 'row',
    width: '100%',
    gap: 10,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  cancelBtnText: {
    fontSize: 13,
    fontWeight: '600',
  },
  confirmBtn: {
    flex: 1.2,
    flexDirection: 'row',
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#ffffff',
  },
});
