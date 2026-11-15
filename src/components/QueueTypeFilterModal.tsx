import React, { useState, useMemo } from 'react';
import {
  View,
  StyleSheet,
  Text,
  Modal,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import * as Haptics from 'expo-haptics';
import { QueueItem, formatFileSize } from '@/lib/storage/queue';
import { getFileCategory } from '@/lib/storage/fileHelper';
import { useAppTheme } from '@/context/ThemeContext';
import { appAlert } from '@/components/AppAlert';

export type FileCategoryKey = 'image' | 'video' | 'audio' | 'document' | 'other';

interface CategoryMeta {
  key: FileCategoryKey;
  label: string;
  icon: React.ComponentProps<typeof FontAwesome>['name'];
  color: string;
}

const CATEGORIES: CategoryMeta[] = [
  { key: 'image', label: 'Images', icon: 'picture-o', color: '#208AEF' },
  { key: 'video', label: 'Videos', icon: 'video-camera', color: '#8B5CF6' },
  { key: 'audio', label: 'Audio', icon: 'music', color: '#EC4899' },
  { key: 'document', label: 'Documents', icon: 'file-text-o', color: '#10B981' },
  { key: 'other', label: 'Other Files', icon: 'file-o', color: '#64748B' },
];

interface QueueTypeFilterModalProps {
  visible: boolean;
  queue: QueueItem[];
  onClose: () => void;
  onUploadCategories: (categories: FileCategoryKey[]) => void;
  onDiscardCategories: (categories: FileCategoryKey[]) => void;
}

export function QueueTypeFilterModal({
  visible,
  queue,
  onClose,
  onUploadCategories,
  onDiscardCategories,
}: QueueTypeFilterModalProps) {
  const insets = useSafeAreaInsets();
  const { isDark } = useAppTheme();

  const [selected, setSelected] = useState<Record<FileCategoryKey, boolean>>({
    image: true,
    video: true,
    audio: true,
    document: true,
    other: true,
  });

  const categoryStats = useMemo(() => {
    const stats: Record<
      FileCategoryKey,
      { totalCount: number; totalBytes: number; pendingCount: number; pendingBytes: number; completedCount: number }
    > = {
      image: { totalCount: 0, totalBytes: 0, pendingCount: 0, pendingBytes: 0, completedCount: 0 },
      video: { totalCount: 0, totalBytes: 0, pendingCount: 0, pendingBytes: 0, completedCount: 0 },
      audio: { totalCount: 0, totalBytes: 0, pendingCount: 0, pendingBytes: 0, completedCount: 0 },
      document: { totalCount: 0, totalBytes: 0, pendingCount: 0, pendingBytes: 0, completedCount: 0 },
      other: { totalCount: 0, totalBytes: 0, pendingCount: 0, pendingBytes: 0, completedCount: 0 },
    };

    for (const item of queue) {
      const cat = getFileCategory(item.fileName, item.mimeType) as FileCategoryKey;
      const bucket = stats[cat] || stats.other;
      bucket.totalCount++;
      bucket.totalBytes += item.size || 0;
      if (item.status === 'pending' || item.status === 'uploading') {
        bucket.pendingCount++;
        bucket.pendingBytes += item.size || 0;
      } else if (item.status === 'completed') {
        bucket.completedCount++;
      }
    }

    return stats;
  }, [queue]);

  const activeSelectedKeys = useMemo(() => {
    return CATEGORIES.map((c) => c.key).filter((k) => selected[k]);
  }, [selected]);

  const selectedPendingCount = useMemo(() => {
    return activeSelectedKeys.reduce((sum, k) => sum + categoryStats[k].pendingCount, 0);
  }, [activeSelectedKeys, categoryStats]);

  const selectedPendingBytes = useMemo(() => {
    return activeSelectedKeys.reduce((sum, k) => sum + categoryStats[k].pendingBytes, 0);
  }, [activeSelectedKeys, categoryStats]);

  const selectedTotalCount = useMemo(() => {
    return activeSelectedKeys.reduce((sum, k) => sum + categoryStats[k].totalCount, 0);
  }, [activeSelectedKeys, categoryStats]);

  const toggleCategory = (key: FileCategoryKey) => {
    Haptics.selectionAsync().catch(() => {});
    setSelected((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const selectAll = () => {
    Haptics.selectionAsync().catch(() => {});
    setSelected({
      image: true,
      video: true,
      audio: true,
      document: true,
      other: true,
    });
  };

  const deselectAll = () => {
    Haptics.selectionAsync().catch(() => {});
    setSelected({
      image: false,
      video: false,
      audio: false,
      document: false,
      other: false,
    });
  };

  const handleStartUpload = () => {
    if (activeSelectedKeys.length === 0 || selectedPendingCount === 0) {
      appAlert('No Files Selected', 'Please select at least one category with pending files to upload.');
      return;
    }
    onClose();
    onUploadCategories(activeSelectedKeys);
  };

  const handleDiscard = () => {
    if (activeSelectedKeys.length === 0 || selectedTotalCount === 0) {
      appAlert('No Files Selected', 'Please select at least one category to remove from the queue.');
      return;
    }

    const labels = activeSelectedKeys.map((k) => CATEGORIES.find((c) => c.key === k)?.label || k).join(', ');
    appAlert(
      'Discard Selected Types',
      `Are you sure you want to remove all ${selectedTotalCount} files (${labels}) from the queue? Other file types will remain.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: `Discard ${selectedTotalCount} Files`,
          style: 'destructive',
          onPress: () => {
            onClose();
            onDiscardCategories(activeSelectedKeys);
          },
        },
      ]
    );
  };

  const cardBg = isDark ? '#1E293B' : '#FFFFFF';
  const screenBg = isDark ? '#0F172A' : '#F8FAFC';
  const textPrimary = isDark ? '#F8FAFC' : '#0F172A';
  const textSecondary = isDark ? '#94A3B8' : '#64748B';
  const border = isDark ? '#334155' : '#E2E8F0';

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={[styles.modalSafe, { backgroundColor: screenBg }]}>
        {/* Header */}
        <View style={[styles.headerRow, { borderBottomColor: border }]}>
          <View style={styles.headerTitleWrap}>
            <View style={styles.headerIconCircle}>
              <FontAwesome name="sliders" size={16} color="#208AEF" />
            </View>
            <View>
              <Text style={[styles.headerTitle, { color: textPrimary }]}>Upload by File Type</Text>
              <Text style={[styles.headerSubtitle, { color: textSecondary }]}>
                Control which files from your queue to process
              </Text>
            </View>
          </View>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <FontAwesome name="times" size={18} color={textSecondary} />
          </TouchableOpacity>
        </View>

        {/* Quick select buttons */}
        <View style={styles.quickBar}>
          <Text style={[styles.quickBarLabel, { color: textSecondary }]}>
            {selectedPendingCount} pending ({formatFileSize(selectedPendingBytes)})
          </Text>
          <View style={styles.quickBtnGroup}>
            <TouchableOpacity onPress={selectAll} style={styles.quickTextBtn}>
              <Text style={styles.quickTextBtnText}>Select All</Text>
            </TouchableOpacity>
            <Text style={{ color: border }}>•</Text>
            <TouchableOpacity onPress={deselectAll} style={styles.quickTextBtn}>
              <Text style={styles.quickTextBtnText}>Clear All</Text>
            </TouchableOpacity>
          </View>
        </View>

        <ScrollView contentContainerStyle={styles.scrollContent}>
          {CATEGORIES.map((cat) => {
            const stats = categoryStats[cat.key];
            const isChecked = selected[cat.key];
            const hasFiles = stats.totalCount > 0;

            return (
              <TouchableOpacity
                key={cat.key}
                activeOpacity={hasFiles ? 0.75 : 1}
                onPress={() => hasFiles && toggleCategory(cat.key)}
                style={[
                  styles.categoryCard,
                  { backgroundColor: cardBg, borderColor: isChecked && hasFiles ? cat.color : border },
                  !hasFiles && styles.categoryCardEmpty,
                ]}
              >
                {/* Category Icon */}
                <View style={[styles.catIconWrap, { backgroundColor: cat.color + '1A' }]}>
                  <FontAwesome name={cat.icon} size={20} color={hasFiles ? cat.color : '#94A3B8'} />
                </View>

                {/* Details */}
                <View style={styles.catDetailsCol}>
                  <View style={styles.catTitleRow}>
                    <Text style={[styles.catLabel, { color: hasFiles ? textPrimary : textSecondary }]}>
                      {cat.label}
                    </Text>
                    <Text style={[styles.catTotalBadge, { color: hasFiles ? cat.color : textSecondary }]}>
                      {stats.totalCount} in queue
                    </Text>
                  </View>
                  <Text style={[styles.catMetaText, { color: textSecondary }]}>
                    {stats.pendingCount > 0
                      ? `${stats.pendingCount} pending • ${formatFileSize(stats.pendingBytes)}`
                      : stats.completedCount > 0
                      ? `${stats.completedCount} completed`
                      : 'None in queue'}
                  </Text>
                </View>

                {/* Checkbox */}
                <View
                  style={[
                    styles.checkbox,
                    {
                      borderColor: isChecked && hasFiles ? cat.color : border,
                      backgroundColor: isChecked && hasFiles ? cat.color : 'transparent',
                    },
                    !hasFiles && { opacity: 0.3 },
                  ]}
                >
                  {isChecked && hasFiles && <FontAwesome name="check" size={12} color="#FFFFFF" />}
                </View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Footer Actions */}
        <View style={[styles.footer, { borderTopColor: border, paddingBottom: Math.max(16, insets.bottom + 8) }]}>
          <TouchableOpacity
            style={[styles.primaryActionBtn, selectedPendingCount === 0 && styles.btnDisabled]}
            disabled={selectedPendingCount === 0}
            onPress={handleStartUpload}
          >
            <FontAwesome name="cloud-upload" size={16} color="#FFFFFF" style={{ marginRight: 8 }} />
            <Text style={styles.primaryActionBtnText}>
              Upload Selected ({selectedPendingCount})
            </Text>
          </TouchableOpacity>

          {selectedTotalCount > 0 && (
            <TouchableOpacity style={styles.discardActionBtn} onPress={handleDiscard}>
              <FontAwesome name="trash" size={13} color="#EF4444" style={{ marginRight: 6 }} />
              <Text style={styles.discardActionBtnText}>
                Discard Selected ({selectedTotalCount}) from Queue
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalSafe: {
    flex: 1,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  headerIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(32, 138, 239, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  headerSubtitle: {
    fontSize: 12,
    marginTop: 1,
  },
  closeBtn: {
    padding: 6,
  },
  quickBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  quickBarLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  quickBtnGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  quickTextBtn: {
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  quickTextBtnText: {
    color: '#208AEF',
    fontSize: 12,
    fontWeight: '700',
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 20,
    gap: 10,
  },
  categoryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 14,
    borderWidth: 1.5,
  },
  categoryCardEmpty: {
    opacity: 0.6,
  },
  catIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  catDetailsCol: {
    flex: 1,
  },
  catTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  catLabel: {
    fontSize: 15,
    fontWeight: '700',
  },
  catTotalBadge: {
    fontSize: 12,
    fontWeight: '700',
    marginRight: 8,
  },
  catMetaText: {
    fontSize: 12,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 7,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  primaryActionBtn: {
    backgroundColor: '#208AEF',
    borderRadius: 12,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 2,
    shadowColor: '#208AEF',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  btnDisabled: {
    opacity: 0.4,
  },
  primaryActionBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  discardActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
  },
  discardActionBtnText: {
    color: '#EF4444',
    fontSize: 13,
    fontWeight: '600',
  },
});
