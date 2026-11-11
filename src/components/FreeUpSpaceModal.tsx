import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Alert,
  useColorScheme,
} from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import * as Haptics from 'expo-haptics';
import {
  analyzeCleanableSpace,
  executeCleanSpace,
  CleanerAnalysis,
} from '@/lib/storage/cleaner';
import { formatFileSize } from '@/lib/storage/queue';

interface FreeUpSpaceModalProps {
  visible: boolean;
  onClose: () => void;
  onCleanComplete?: (freedBytes: number, freedCount: number) => void;
}

type CategoryFilter = 'all' | 'image' | 'video' | 'audio' | 'document' | 'other';

export function FreeUpSpaceModal({
  visible,
  onClose,
  onCleanComplete,
}: FreeUpSpaceModalProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  const [loading, setLoading] = useState(true);
  const [analysis, setAnalysis] = useState<CleanerAnalysis | null>(null);
  const [selectedUris, setSelectedUris] = useState<Set<string>>(new Set());
  const [activeCategory, setActiveCategory] = useState<CategoryFilter>('all');
  const [isCleaning, setIsCleaning] = useState(false);
  const [cleanProgress, setCleanProgress] = useState<{ current: number; total: number }>({
    current: 0,
    total: 0,
  });

  const loadCandidates = async () => {
    setLoading(true);
    try {
      const result = await analyzeCleanableSpace();
      setAnalysis(result);
      // Default to selecting all eligible files
      setSelectedUris(new Set(result.candidates.map((c) => c.uri)));
    } catch (err) {
      console.error('Failed to analyze cleanable space:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (visible) {
      loadCandidates();
    }
  }, [visible]);

  const filteredCandidates = useMemo(() => {
    if (!analysis) return [];
    if (activeCategory === 'all') return analysis.candidates;
    return analysis.candidates.filter((c) => c.category === activeCategory);
  }, [analysis, activeCategory]);

  const selectedStats = useMemo(() => {
    if (!analysis) return { count: 0, bytes: 0 };
    let bytes = 0;
    let count = 0;
    for (const c of analysis.candidates) {
      if (selectedUris.has(c.uri)) {
        bytes += c.size;
        count += 1;
      }
    }
    return { count, bytes };
  }, [analysis, selectedUris]);

  const toggleSelect = (uri: string) => {
    Haptics.selectionAsync().catch(() => {});
    setSelectedUris((prev) => {
      const next = new Set(prev);
      if (next.has(uri)) {
        next.delete(uri);
      } else {
        next.add(uri);
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    if (!analysis) return;
    if (selectedUris.size === analysis.candidates.length) {
      setSelectedUris(new Set());
    } else {
      setSelectedUris(new Set(analysis.candidates.map((c) => c.uri)));
    }
  };

  const handleExecuteClean = () => {
    if (selectedStats.count === 0 || !analysis) return;

    Alert.alert(
      'Free Up Space Confirmation',
      `Delete ${selectedStats.count} local file(s) to free up ${formatFileSize(selectedStats.bytes)}?\n\nThese files are already safely uploaded to Telegram cloud.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: `Free Up ${formatFileSize(selectedStats.bytes)}`,
          style: 'destructive',
          onPress: async () => {
            setIsCleaning(true);
            const itemsToClean = analysis.candidates.filter((c) => selectedUris.has(c.uri));
            setCleanProgress({ current: 0, total: itemsToClean.length });

            try {
              const result = await executeCleanSpace(itemsToClean, (cur, tot) => {
                setCleanProgress({ current: cur, total: tot });
              });

              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});

              const message = result.blockedCount > 0
                ? `Successfully freed up ${formatFileSize(result.freedBytes)} (${result.freedCount} files deleted locally).\n\n🛡️ Safety Shield protected ${result.blockedCount} file(s) whose Telegram cloud copy was deleted.`
                : `Successfully freed up ${formatFileSize(result.freedBytes)} of device storage (${result.freedCount} files deleted locally).`;

              Alert.alert('Space Reclaimed', message);

              if (onCleanComplete) {
                onCleanComplete(result.freedBytes, result.freedCount);
              }
              onClose();
            } catch (err: any) {
              Alert.alert('Cleaner Error', err?.message || 'Failed to complete cleanup.');
            } finally {
              setIsCleaning(false);
            }
          },
        },
      ]
    );
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'image':
        return 'file-image-o';
      case 'video':
        return 'file-video-o';
      case 'audio':
        return 'file-audio-o';
      case 'document':
        return 'file-text-o';
      default:
        return 'file-o';
    }
  };

  const bg = isDark ? '#121212' : '#F8FAFC';
  const cardBg = isDark ? '#1E293B' : '#FFFFFF';
  const textColor = isDark ? '#F1F5F9' : '#0F172A';
  const subtextColor = isDark ? '#94A3B8' : '#64748B';
  const border = isDark ? '#334155' : '#E2E8F0';

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={[styles.modalSheet, { backgroundColor: bg }]}>
          {/* Header */}
          <View style={[styles.modalHeader, { borderBottomColor: border }]}>
            <View style={styles.headerTitleWrap}>
              <View style={styles.headerIconBadge}>
                <FontAwesome name="recycle" size={18} color="#10B981" />
              </View>
              <View>
                <Text style={[styles.modalTitle, { color: textColor }]}>Free Up Space</Text>
                <Text style={[styles.modalSubtitle, { color: subtextColor }]}>
                  Reclaim local storage for backed-up files
                </Text>
              </View>
            </View>
            <TouchableOpacity
              onPress={onClose}
              disabled={isCleaning}
              style={[styles.closeButton, { backgroundColor: cardBg, borderColor: border }]}
            >
              <FontAwesome name="times" size={16} color={subtextColor} />
            </TouchableOpacity>
          </View>

          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#10B981" />
              <Text style={[styles.loadingText, { color: subtextColor }]}>
                Scanning backed-up files on device...
              </Text>
            </View>
          ) : isCleaning ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#10B981" />
              <Text style={[styles.loadingTitle, { color: textColor }]}>Reclaiming Storage...</Text>
              <Text style={[styles.loadingText, { color: subtextColor }]}>
                Deleting {cleanProgress.current} of {cleanProgress.total} local files
              </Text>
              <View style={[styles.progressBarBg, { backgroundColor: border }]}>
                <View
                  style={[
                    styles.progressBarFill,
                    {
                      width: `${
                        cleanProgress.total > 0
                          ? Math.round((cleanProgress.current / cleanProgress.total) * 100)
                          : 0
                      }%`,
                    },
                  ]}
                />
              </View>
            </View>
          ) : !analysis || analysis.candidates.length === 0 ? (
            <View style={styles.emptyContainer}>
              <View style={styles.emptyIconBadge}>
                <FontAwesome name="check-circle" size={42} color="#10B981" />
              </View>
              <Text style={[styles.emptyTitle, { color: textColor }]}>Device Storage Clean</Text>
              <Text style={[styles.emptySubtitle, { color: subtextColor }]}>
                No local copies found that are already backed up to Telegram. All synced media is safely managed!
              </Text>
            </View>
          ) : (
            <>
              {/* Highlight Banner */}
              <View style={[styles.bannerCard, { backgroundColor: isDark ? '#064E3B' : '#ECFDF5', borderColor: '#10B981' }]}>
                <View style={styles.bannerContent}>
                  <View>
                    <Text style={[styles.bannerHeadline, { color: isDark ? '#A7F3D0' : '#065F46' }]}>
                      {formatFileSize(analysis.totalBytes)} Reclaimable
                    </Text>
                    <Text style={[styles.bannerSubhead, { color: isDark ? '#D1FAE5' : '#047857' }]}>
                      {analysis.totalCount} local file(s) are safely preserved in Telegram cloud.
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={handleSelectAll}
                    style={[styles.selectAllBtn, { backgroundColor: isDark ? '#047857' : '#D1FAE5' }]}
                  >
                    <Text style={[styles.selectAllText, { color: isDark ? '#ECFDF5' : '#065F46' }]}>
                      {selectedUris.size === analysis.candidates.length ? 'Deselect All' : 'Select All'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Category Filter Chips */}
              <View style={styles.categoriesRow}>
                {(['all', 'image', 'video', 'audio', 'document'] as CategoryFilter[]).map((cat) => {
                  const count =
                    cat === 'all' ? analysis.totalCount : analysis.categories[cat]?.count || 0;
                  if (cat !== 'all' && count === 0) return null;

                  const isSelected = activeCategory === cat;
                  return (
                    <TouchableOpacity
                      key={cat}
                      onPress={() => {
                        Haptics.selectionAsync().catch(() => {});
                        setActiveCategory(cat);
                      }}
                      style={[
                        styles.catChip,
                        {
                          backgroundColor: isSelected ? '#10B981' : cardBg,
                          borderColor: isSelected ? '#10B981' : border,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.catChipText,
                          { color: isSelected ? '#FFFFFF' : textColor },
                        ]}
                      >
                        {cat === 'all'
                          ? 'All'
                          : cat.charAt(0).toUpperCase() + cat.slice(1)} ({count})
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Candidates List */}
              <FlatList
                data={filteredCandidates}
                keyExtractor={(item) => item.uri}
                contentContainerStyle={styles.listContent}
                renderItem={({ item }) => {
                  const isChecked = selectedUris.has(item.uri);
                  return (
                    <TouchableOpacity
                      onPress={() => toggleSelect(item.uri)}
                      activeOpacity={0.7}
                      style={[
                        styles.candidateRow,
                        { backgroundColor: cardBg, borderColor: isChecked ? '#10B981' : border },
                      ]}
                    >
                      <View style={[styles.checkbox, isChecked && styles.checkboxActive]}>
                        {isChecked && <FontAwesome name="check" size={11} color="#FFFFFF" />}
                      </View>
                      <View style={styles.fileIconWrap}>
                        <FontAwesome name={getCategoryIcon(item.category) as any} size={20} color="#6366F1" />
                      </View>
                      <View style={styles.fileInfoWrap}>
                        <Text style={[styles.fileName, { color: textColor }]} numberOfLines={1}>
                          {item.fileName}
                        </Text>
                        <View style={styles.fileMetaRow}>
                          <Text style={[styles.fileSize, { color: subtextColor }]}>
                            {formatFileSize(item.size)}
                          </Text>
                          <Text style={[styles.fileMetaDot, { color: subtextColor }]}>•</Text>
                          <View style={styles.cloudBadge}>
                            <FontAwesome name="cloud" size={10} color="#10B981" />
                            <Text style={styles.cloudBadgeText}>Backed Up</Text>
                          </View>
                        </View>
                      </View>
                    </TouchableOpacity>
                  );
                }}
              />

              {/* Bottom Action Footer */}
              <View style={[styles.footerBar, { backgroundColor: cardBg, borderTopColor: border }]}>
                <View style={styles.footerStats}>
                  <Text style={[styles.footerLabel, { color: subtextColor }]}>Selected for cleaning</Text>
                  <Text style={[styles.footerValue, { color: textColor }]}>
                    {selectedStats.count} files ({formatFileSize(selectedStats.bytes)})
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={handleExecuteClean}
                  disabled={selectedStats.count === 0}
                  style={[
                    styles.cleanBtn,
                    {
                      backgroundColor: selectedStats.count > 0 ? '#EF4444' : border,
                      opacity: selectedStats.count > 0 ? 1 : 0.6,
                    },
                  ]}
                >
                  <FontAwesome name="trash" size={15} color="#FFFFFF" style={{ marginRight: 8 }} />
                  <Text style={styles.cleanBtnText}>
                    Free Up {formatFileSize(selectedStats.bytes)}
                  </Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    height: '86%',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 16,
    overflow: 'hidden',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
  },
  headerTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerIconBadge: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  modalSubtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  loadingTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginTop: 16,
  },
  loadingText: {
    fontSize: 14,
    marginTop: 8,
    textAlign: 'center',
  },
  progressBarBg: {
    width: '100%',
    height: 8,
    borderRadius: 4,
    marginTop: 20,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#10B981',
    borderRadius: 4,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 36,
  },
  emptyIconBadge: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  bannerCard: {
    margin: 16,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  bannerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  bannerHeadline: {
    fontSize: 16,
    fontWeight: '700',
  },
  bannerSubhead: {
    fontSize: 12,
    marginTop: 2,
    maxWidth: 220,
  },
  selectAllBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  selectAllText: {
    fontSize: 12,
    fontWeight: '600',
  },
  categoriesRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingBottom: 10,
    gap: 8,
  },
  catChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
  },
  catChipText: {
    fontSize: 12,
    fontWeight: '600',
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 100,
    gap: 8,
  },
  candidateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: '#94A3B8',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  checkboxActive: {
    backgroundColor: '#10B981',
    borderColor: '#10B981',
  },
  fileIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: 'rgba(99, 102, 241, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  fileInfoWrap: {
    flex: 1,
  },
  fileName: {
    fontSize: 14,
    fontWeight: '600',
  },
  fileMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 3,
    gap: 6,
  },
  fileSize: {
    fontSize: 12,
  },
  fileMetaDot: {
    fontSize: 12,
  },
  cloudBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  cloudBadgeText: {
    fontSize: 11,
    color: '#10B981',
    fontWeight: '600',
  },
  footerBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderTopWidth: 1,
  },
  footerLabel: {
    fontSize: 11,
  },
  footerValue: {
    fontSize: 14,
    fontWeight: '700',
  },
  footerStats: {
    flex: 1,
  },
  cleanBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
  },
  cleanBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
});
