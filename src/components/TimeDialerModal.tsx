import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  Modal,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';

interface TimeDialerModalProps {
  visible: boolean;
  title: string;
  initialTime: string; // HH:mm (24-hour)
  onConfirm: (time: string) => void;
  onClose: () => void;
}

const DIAL_SIZE = 260;
const DIAL_RADIUS = 96;
const CENTER = DIAL_SIZE / 2;

const HOURS = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const MINUTES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

export function TimeDialerModal({
  visible,
  title,
  initialTime,
  onConfirm,
  onClose,
}: TimeDialerModalProps) {
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
    setSelectedMinute(min);
  };

  const adjustMinute = (delta: number) => {
    setSelectedMinute((prev) => {
      let next = prev + delta;
      if (next >= 60) next = 0;
      if (next < 0) next = 59;
      return next;
    });
  };

  const handleSave = () => {
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

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          {/* Header */}
          <Text style={styles.modalTitle}>{title}</Text>

          {/* Digital Time Preview & Mode Selector */}
          <View style={styles.timeDisplayRow}>
            <View style={styles.timeNumbersContainer}>
              <TouchableOpacity
                style={[styles.timeBox, mode === 'hour' && styles.timeBoxActive]}
                onPress={() => setMode('hour')}
              >
                <Text
                  style={[
                    styles.timeBoxText,
                    mode === 'hour' && styles.timeBoxTextActive,
                  ]}
                >
                  {String(selectedHour).padStart(2, '0')}
                </Text>
              </TouchableOpacity>

              <Text style={styles.timeColon}>:</Text>

              <TouchableOpacity
                style={[styles.timeBox, mode === 'minute' && styles.timeBoxActive]}
                onPress={() => setMode('minute')}
              >
                <Text
                  style={[
                    styles.timeBoxText,
                    mode === 'minute' && styles.timeBoxTextActive,
                  ]}
                >
                  {String(selectedMinute).padStart(2, '0')}
                </Text>
              </TouchableOpacity>
            </View>

            {/* AM / PM Toggle */}
            <View style={styles.periodToggle}>
              <TouchableOpacity
                style={[styles.periodBtn, period === 'AM' && styles.periodBtnActive]}
                onPress={() => setPeriod('AM')}
              >
                <Text
                  style={[
                    styles.periodText,
                    period === 'AM' && styles.periodTextActive,
                  ]}
                >
                  AM
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.periodBtn, period === 'PM' && styles.periodBtnActive]}
                onPress={() => setPeriod('PM')}
              >
                <Text
                  style={[
                    styles.periodText,
                    period === 'PM' && styles.periodTextActive,
                  ]}
                >
                  PM
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          <Text style={styles.preview24h}>
            24-hour format: <Text style={{ fontWeight: '700' }}>{getFormatted24h()}</Text>
          </Text>

          {/* Clock Face Dial */}
          <View style={styles.dialContainer}>
            <View style={styles.dialFace}>
              {/* Dial Center Pivot */}
              <View style={styles.dialCenterDot} />

              {/* Needle Pointer Line */}
              <View
                style={[
                  styles.needleLine,
                  {
                    left: CENTER,
                    top: CENTER - 1,
                    width: DIAL_RADIUS,
                    transform: [
                      { rotate: `${needleAngle - 90}deg` },
                    ],
                  },
                ]}
              />

              {/* Glowing Pointer Head */}
              <View
                style={[
                  styles.pointerHead,
                  {
                    left: needleX - 18,
                    top: needleY - 18,
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
                        style={[
                          styles.dialNumberItem,
                          { left: x - 18, top: y - 18 },
                        ]}
                        onPress={() => handleHourSelect(h)}
                        activeOpacity={0.7}
                      >
                        <Text
                          style={[
                            styles.dialNumberText,
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
                    // Match nearest multiple of 5 for selection highlight
                    const isSelected = selectedMinute === m;

                    return (
                      <TouchableOpacity
                        key={`m-${m}`}
                        style={[
                          styles.dialNumberItem,
                          { left: x - 18, top: y - 18 },
                        ]}
                        onPress={() => handleMinuteSelect(m)}
                        activeOpacity={0.7}
                      >
                        <Text
                          style={[
                            styles.dialNumberText,
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
            <TouchableOpacity style={styles.stepperBtn} onPress={() => adjustMinute(-5)}>
              <Text style={styles.stepperText}>-5m</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.stepperBtn} onPress={() => adjustMinute(-1)}>
              <Text style={styles.stepperText}>-1m</Text>
            </TouchableOpacity>
            <Text style={styles.fineAdjustLabel}>Fine Tune</Text>
            <TouchableOpacity style={styles.stepperBtn} onPress={() => adjustMinute(1)}>
              <Text style={styles.stepperText}>+1m</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.stepperBtn} onPress={() => adjustMinute(5)}>
              <Text style={styles.stepperText}>+5m</Text>
            </TouchableOpacity>
          </View>

          {/* Action Buttons */}
          <View style={styles.modalActions}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.confirmBtn} onPress={handleSave}>
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
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    backgroundColor: '#ffffff',
    borderRadius: 24,
    padding: 22,
    width: '100%',
    maxWidth: 340,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 10,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 16,
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
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
  },
  timeBoxActive: {
    backgroundColor: '#e0f2fe',
    borderWidth: 1.5,
    borderColor: '#208AEF',
  },
  timeBoxText: {
    fontSize: 32,
    fontWeight: '700',
    color: '#475569',
  },
  timeBoxTextActive: {
    color: '#208AEF',
  },
  timeColon: {
    fontSize: 28,
    fontWeight: '700',
    color: '#94a3b8',
    marginHorizontal: 4,
  },
  periodToggle: {
    backgroundColor: '#f1f5f9',
    borderRadius: 10,
    padding: 3,
  },
  periodBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 7,
  },
  periodBtnActive: {
    backgroundColor: '#208AEF',
  },
  periodText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748b',
  },
  periodTextActive: {
    color: '#ffffff',
  },
  preview24h: {
    fontSize: 12,
    color: '#64748b',
    marginBottom: 14,
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
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    position: 'relative',
  },
  dialCenterDot: {
    position: 'absolute',
    left: CENTER - 4,
    top: CENTER - 4,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#208AEF',
    zIndex: 10,
  },
  needleLine: {
    position: 'absolute',
    height: 2,
    backgroundColor: '#208AEF',
    zIndex: 5,
    transformOrigin: 'left center' as any,
  },
  pointerHead: {
    position: 'absolute',
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#208AEF',
    zIndex: 6,
  },
  dialNumberItem: {
    position: 'absolute',
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 8,
  },
  dialNumberText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#334155',
  },
  dialNumberTextSelected: {
    color: '#ffffff',
    fontWeight: '700',
  },
  fineAdjustRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 16,
  },
  fineAdjustLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#94a3b8',
    marginHorizontal: 2,
  },
  stepperBtn: {
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
  },
  stepperText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#475569',
  },
  modalActions: {
    flexDirection: 'row',
    width: '100%',
    gap: 12,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 12,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
  },
  cancelBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#64748b',
  },
  confirmBtn: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 12,
    backgroundColor: '#208AEF',
    alignItems: 'center',
  },
  confirmBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
  },
});
