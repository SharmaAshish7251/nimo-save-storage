import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Platform,
  Linking,
  AppState,
  AppStateStatus,
  ScrollView,
} from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useAppTheme } from '@/context/ThemeContext';
import {
  analyzeCleanableSpace,
  executeCleanSpace,
  CleanerAnalysis,
} from '@/lib/storage/cleaner';
import { formatFileSize } from '@/lib/storage/queue';
import { appAlert } from '@/components/AppAlert';

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
  const insets = useSafeAreaInsets();
  const { isDark } = useAppTheme();

  const [loading, setLoading] = useState(true);
  const [analysis, setAnalysis] = useState<CleanerAnalysis | null>(null);
  const [selectedUris, setSelectedUris] = useState<Set<string>>(new Set());
  const [activeCategory, setActiveCategory] = useState<CategoryFilter>('all');
  const [displayLimit, setDisplayLimit] = useState(40);
  const [isCleaning, setIsCleaning] = useState(false);
  const [cleanProgress, setCleanProgress] = useState<{ current: number; total: number }>({
    current: 0,
    total: 0,
  });
  const cleanAbortRef = useRef<AbortController | null>(null);
  // Track whether this is the very first open (to auto-select all)
  const isFirstOpen = useRef(true);
  const appStateRef = useRef<AppStateStatus>((AppState.currentState as AppStateStatus) || 'active');

  const handleCancelClean = () => {
    if (cleanAbortRef.current) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      cleanAbortRef.current.abort();
    }
  };

  const handleCancelSelection = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setSelectedUris(new Set());
  };

  const loadCandidates = useCallback(async (forceRefresh = false, preserveSelection = false) => {
    setLoading(true);
    try {
      const result = await analyzeCleanableSpace({ forceRefresh });
      setAnalysis(result);
      if (!preserveSelection) {
        // Auto-select all on first open
        setSelectedUris(new Set(result.candidates.map((c) => c.uri)));
      } else {
        // Returning from Settings: keep existing selection but prune deleted URIs
        setSelectedUris((prev) => {
          const validUris = new Set(result.candidates.map((c) => c.uri));
          return new Set([...prev].filter((uri) => validUris.has(uri)));
        });
      }
    } catch (err) {
      console.error('Failed to analyze cleanable space:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load — auto-select all, reset category
  useEffect(() => {
    if (visible) {
      setDisplayLimit(40);
      setActiveCategory('all');
      isFirstOpen.current = true;
      loadCandidates(false, false);
    }
  }, [visible, loadCandidates]);

  // AppState listener: when user returns from Android Settings, reload WITHOUT losing selection
  useEffect(() => {
    if (!visible) return;
    const subscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (
        appStateRef.current.match(/inactive|background/) &&
        nextState === 'active' &&
        !isFirstOpen.current
      ) {
        // User came back from Settings — preserve their selection
        loadCandidates(true, true);
      }
      // After the very first load cycle, mark first-open done
      if (nextState === 'active') {
        isFirstOpen.current = false;
      }
      appStateRef.current = nextState;
    });
    return () => subscription.remove();
  }, [visible, loadCandidates]);

  const filteredCandidates = useMemo(() => {
    if (!analysis) return [];
    if (activeCategory === 'all') return analysis.candidates;
    return analysis.candidates.filter((c) => c.category === activeCategory);
  }, [analysis, activeCategory]);

  const paginatedCandidates = useMemo(() => {
    return filteredCandidates.slice(0, displayLimit);
  }, [filteredCandidates, displayLimit]);

  const handleCategoryChange = (cat: CategoryFilter) => {
    setActiveCategory(cat);
    setDisplayLimit(40);
  };

  // Per-category selection stats — drives chip badges and select-all label
  const categorySelectionMap = useMemo(() => {
    if (!analysis) return {} as Record<string, { selected: number; total: number; bytes: number }>;
    const map: Record<string, { selected: number; total: number; bytes: number }> = {
      all: { selected: 0, total: analysis.candidates.length, bytes: 0 },
    };
    for (const c of analysis.candidates) {
      if (!map[c.category]) map[c.category] = { selected: 0, total: 0, bytes: 0 };
      map[c.category].total += 1;
      if (selectedUris.has(c.uri)) {
        map[c.category].selected += 1;
        map[c.category].bytes += c.size;
        map.all.selected += 1;
        map.all.bytes += c.size;
      }
    }
    return map;
  }, [analysis, selectedUris]);

  const selectedStats = useMemo(() => {
    const all = categorySelectionMap.all;
    return { count: all?.selected ?? 0, bytes: all?.bytes ?? 0 };
  }, [categorySelectionMap]);

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

  // Category-aware select all: when a category is active, only toggle that category's items
  const handleSelectAll = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    if (!analysis) return;

    const scopeItems =
      activeCategory === 'all'
        ? analysis.candidates
        : analysis.candidates.filter((c) => c.category === activeCategory);

    const allScopeSelected = scopeItems.length > 0 && scopeItems.every((c) => selectedUris.has(c.uri));

    setSelectedUris((prev) => {
      const next = new Set(prev);
      if (allScopeSelected) {
        scopeItems.forEach((c) => next.delete(c.uri));
      } else {
        scopeItems.forEach((c) => next.add(c.uri));
      }
      return next;
    });
  };

  // Derive the Select All button label based on active category
  const selectAllLabel = useMemo(() => {
    if (!analysis) return 'Select All';
    const scopeItems =
      activeCategory === 'all'
        ? analysis.candidates
        : analysis.candidates.filter((c) => c.category === activeCategory);
    const allSelected = scopeItems.length > 0 && scopeItems.every((c) => selectedUris.has(c.uri));
    if (activeCategory === 'all') {
      return allSelected ? 'Deselect All' : 'Select All';
    }
    const label = activeCategory.charAt(0).toUpperCase() + activeCategory.slice(1) + 's';
    return allSelected ? `Deselect ${label}` : `Select ${label}`;
  }, [analysis, activeCategory, selectedUris]);

  const handleExecuteClean = () => {
    if (selectedStats.count === 0 || !analysis) return;

    appAlert(
      'Free Up Space Confirmation',
      `Delete ${selectedStats.count} local file(s) to free up ${formatFileSize(selectedStats.bytes)}?\n\nThese files are already safely uploaded to Telegram cloud.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: `Free Up ${formatFileSize(selectedStats.bytes)}`,
          style: 'destructive',
          onPress: async () => {
            const controller = new AbortController();
            cleanAbortRef.current = controller;
            setIsCleaning(true);
            const itemsToClean = analysis.candidates.filter((c) => selectedUris.has(c.uri));
            setCleanProgress({ current: 0, total: itemsToClean.length });

            try {
              const result = await executeCleanSpace(
                itemsToClean,
                (cur, tot) => {
                  setCleanProgress({ current: cur, total: tot });
                },
                controller.signal
              );

              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});

              if (controller.signal.aborted) {
                appAlert(
                  'Cleanup Cancelled',
                  `Deletion was stopped. Freed ${formatFileSize(result.freedBytes)} (${result.freedCount} file(s) deleted).`
                );
              } else {
                const parts: string[] = [];
                if (result.freedCount > 0) {
                  parts.push(
                    `Freed ${formatFileSize(result.freedBytes)} (${result.freedCount} file(s) deleted locally).`
                  );
                } else {
                  parts.push('No local files were deleted.');
                }
                if (result.blockedCount > 0) {
                  parts.push(
                    `Safety Shield protected ${result.blockedCount} file(s) whose Telegram cloud copy was deleted.`
                  );
                }
                if (result.failedCount > 0) {
                  parts.push(
                    `${result.failedCount} file(s) could not be deleted directly without system popups. Please grant "All files access" in Android Settings to allow silent deletion.`
                  );
                }

                if (result.failedCount > 0 && result.freedCount === 0) {
                  appAlert(
                    'Deletion Failed',
                    `${result.failedCount} file(s) could not be deleted.\n\nThis can happen when:\n• The files were already deleted\n• They are stored in a restricted folder\n\nIf this keeps happening, ensure "Allow management of all files" is enabled in Storage Settings.`,
                    [
                      { text: 'OK', style: 'cancel' },
                      { text: 'Open Settings', onPress: () => Linking.openSettings() },
                    ]
                  );
                } else {
                  appAlert(
                    result.freedCount > 0 ? 'Space Reclaimed' : 'Cleanup Incomplete',
                    parts.join('\n\n')
                  );
                }
              }

              // Refresh candidate list in-place so deleted items disappear immediately and stats update, preserving any remaining user selection
              await loadCandidates(true, true);

              if (onCleanComplete) {
                onCleanComplete(result.freedBytes, result.freedCount);
              }
            } catch (err: any) {
              appAlert('Cleaner Error', err?.message || 'Failed to complete cleanup.');
            } finally {
              setIsCleaning(false);
              cleanAbortRef.current = null;
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
              <TouchableOpacity
                onPress={handleCancelClean}
                style={[
                  styles.cancelCleaningBtn,
                  { backgroundColor: '#EF4444', borderColor: '#DC2626' },
                ]}
                activeOpacity={0.7}
              >
                <FontAwesome name="stop-circle" size={14} color="#FFFFFF" style={{ marginRight: 8 }} />
                <Text style={[styles.cancelCleaningBtnText, { color: '#FFFFFF', fontWeight: '700' }]}>
                  Cancel Deletion
                </Text>
              </TouchableOpacity>
            </View>
          ) : !analysis || analysis.candidates.length === 0 ? (
            <View style={styles.emptyContainer}>
              <View style={styles.emptyIconBadge}>
                <FontAwesome
                  name={analysis && (analysis.restrictedCount > 0 || analysis.pendingQueueCount > 0) ? 'info-circle' : 'check-circle'}
                  size={42}
                  color={analysis && (analysis.restrictedCount > 0 || analysis.pendingQueueCount > 0) ? '#F59E0B' : '#10B981'}
                />
              </View>
              <Text style={[styles.emptyTitle, { color: textColor }]}>
                {analysis && analysis.restrictedCount > 0
                  ? 'Manual Cleanup Required'
                  : analysis && analysis.pendingQueueCount > 0
                    ? 'Uploads Pending First'
                    : 'Device Storage Clean'}
              </Text>
              <Text style={[styles.emptySubtitle, { color: subtextColor }]}>
                {analysis && analysis.restrictedCount > 0
                  ? `${analysis.restrictedCount} uploaded document-picker file(s) (${formatFileSize(analysis.restrictedBytes)}) were found on your device, but Android only grants read-only access for single-picked documents so they must be deleted from your system Files app.`
                  : analysis && analysis.pendingQueueCount > 0
                    ? `You have ${analysis.pendingQueueCount} file(s) waiting in the upload queue. Upload them to Telegram first before reclaiming local space.`
                    : 'No local copies found that are already backed up to Telegram. All synced media is safely managed!'}
              </Text>
              {analysis && analysis.restrictedCount > 0 && (
                <View style={[styles.noticeCard, { backgroundColor: cardBg, borderColor: border, marginTop: 16, width: '100%' }]}>
                  {analysis.restrictedCandidates.slice(0, 5).map((item) => (
                    <Text key={item.uri} style={[styles.noticeItemText, { color: textColor }]} numberOfLines={1}>
                      • {item.fileName} ({formatFileSize(item.size)})
                    </Text>
                  ))}
                  {analysis.restrictedCount > 5 && (
                    <Text style={[styles.noticeSubtext, { color: subtextColor }]}>
                      +{analysis.restrictedCount - 5} more document(s)
                    </Text>
                  )}
                </View>
              )}
            </View>
          ) : (
            <>
              {/* Highlight Banner */}
              <View style={[styles.bannerCard, { backgroundColor: isDark ? '#064E3B' : '#ECFDF5', borderColor: '#10B981' }]}>
                <View style={styles.bannerContent}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.bannerHeadline, { color: isDark ? '#A7F3D0' : '#065F46' }]}>
                      {formatFileSize(analysis.totalBytes)} Reclaimable
                    </Text>
                    <Text style={[styles.bannerSubhead, { color: isDark ? '#D1FAE5' : '#047857' }]}>
                      {selectedStats.count > 0
                        ? `${selectedStats.count} of ${analysis.totalCount} selected · ${formatFileSize(selectedStats.bytes)}`
                        : `${analysis.totalCount} file(s) safely preserved in cloud`}
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={handleSelectAll}
                    style={[styles.selectAllBtn, { backgroundColor: isDark ? '#047857' : '#D1FAE5' }]}
                  >
                    <Text style={[styles.selectAllText, { color: isDark ? '#ECFDF5' : '#065F46' }]}>
                      {selectAllLabel}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Category Filter Chips — horizontal scrollable with per-cat selection badge */}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.categoriesScroll}
              >
                {(['all', 'image', 'video', 'audio', 'document', 'other'] as CategoryFilter[]).map((cat) => {
                  const total =
                    cat === 'all' ? analysis.totalCount : analysis.categories[cat as keyof typeof analysis.categories]?.count || 0;
                  if (cat !== 'all' && total === 0) return null;

                  const sel = categorySelectionMap[cat]?.selected ?? 0;
                  const isActive = activeCategory === cat;
                  const allInCatSelected = total > 0 && sel === total;

                  const catIcon =
                    cat === 'image' ? 'image' :
                    cat === 'video' ? 'film' :
                    cat === 'audio' ? 'music' :
                    cat === 'document' ? 'file-text-o' :
                    cat === 'other' ? 'file-o' : 'th-large';

                  const catColor =
                    cat === 'image' ? '#208AEF' :
                    cat === 'video' ? '#8B5CF6' :
                    cat === 'audio' ? '#EC4899' :
                    cat === 'document' ? '#10B981' :
                    cat === 'other' ? '#64748B' : '#10B981';

                  return (
                    <TouchableOpacity
                      key={cat}
                      onPress={() => {
                        Haptics.selectionAsync().catch(() => {});
                        handleCategoryChange(cat);
                      }}
                      style={[
                        styles.catChip,
                        {
                          backgroundColor: isActive ? catColor : cardBg,
                          borderColor: isActive ? catColor : (sel > 0 ? catColor + '55' : border),
                        },
                      ]}
                    >
                      <FontAwesome
                        name={catIcon as any}
                        size={11}
                        color={isActive ? '#FFF' : catColor}
                        style={{ marginRight: 5 }}
                      />
                      <Text
                        style={[
                          styles.catChipText,
                          { color: isActive ? '#FFFFFF' : textColor },
                        ]}
                      >
                        {cat === 'all' ? 'All' : cat.charAt(0).toUpperCase() + cat.slice(1)}
                      </Text>
                      {/* Selection badge: shows selected/total */}
                      <View
                        style={[
                          styles.catBadge,
                          {
                            backgroundColor: isActive
                              ? 'rgba(255,255,255,0.25)'
                              : sel > 0
                              ? catColor + '22'
                              : (isDark ? '#334155' : '#E2E8F0'),
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.catBadgeText,
                            { color: isActive ? '#FFF' : sel > 0 ? catColor : subtextColor },
                          ]}
                        >
                          {sel > 0 && !allInCatSelected ? `${sel}/${total}` : `${total}`}
                        </Text>
                      </View>
                      {/* Checkmark pill when all in category are selected */}
                      {allInCatSelected && !isActive && (
                        <FontAwesome name="check-circle" size={12} color={catColor} style={{ marginLeft: 3 }} />
                      )}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              {/* Paginated Candidates List */}
              <FlatList
                data={paginatedCandidates}
                keyExtractor={(item) => item.uri}
                initialNumToRender={15}
                maxToRenderPerBatch={15}
                windowSize={5}
                removeClippedSubviews={Platform.OS === 'android'}
                onEndReachedThreshold={0.5}
                onEndReached={() => {
                  if (displayLimit < filteredCandidates.length) {
                    setDisplayLimit((prev) => Math.min(prev + 40, filteredCandidates.length));
                  }
                }}
                contentContainerStyle={[
                  styles.listContent,
                  { paddingBottom: 110 + Math.max(insets.bottom, 16) },
                ]}
                ListEmptyComponent={
                  <View style={styles.emptyListMsg}>
                    <FontAwesome name="filter" size={28} color={subtextColor} style={{ marginBottom: 8 }} />
                    <Text style={[styles.emptyListText, { color: subtextColor }]}>
                      No {activeCategory === 'all' ? '' : activeCategory + ' '}files in this category
                    </Text>
                  </View>
                }
                ListFooterComponent={
                  analysis.restrictedCount > 0 || analysis.pendingQueueCount > 0 ? (
                    <View style={[styles.noticeCard, { backgroundColor: cardBg, borderColor: border, marginTop: 8 }]}>
                      {analysis.pendingQueueCount > 0 && (
                        <Text style={[styles.noticeSubtext, { color: subtextColor }]}>
                          • {analysis.pendingQueueCount} file(s) still in the upload queue must finish uploading before appearing here.
                        </Text>
                      )}
                      {analysis.restrictedCount > 0 && (
                        <Text style={[styles.noticeSubtext, { color: subtextColor, marginTop: analysis.pendingQueueCount > 0 ? 6 : 0 }]}>
                          • {analysis.restrictedCount} single-picked document(s) ({formatFileSize(analysis.restrictedBytes)}) cannot be auto-deleted due to Android restrictions — delete those manually from your Files app.
                        </Text>
                      )}
                    </View>
                  ) : undefined
                }
                renderItem={({ item }) => {
                  const isChecked = selectedUris.has(item.uri);
                  const catColor =
                    item.category === 'image' ? '#208AEF' :
                    item.category === 'video' ? '#8B5CF6' :
                    item.category === 'audio' ? '#EC4899' :
                    item.category === 'document' ? '#10B981' : '#64748B';
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
                      <View style={[styles.fileIconWrap, { backgroundColor: catColor + '18' }]}>
                        <FontAwesome name={getCategoryIcon(item.category) as any} size={18} color={catColor} />
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
              <View
                style={[
                  styles.footerBar,
                  {
                    backgroundColor: cardBg,
                    borderTopColor: border,
                    paddingBottom: Math.max(insets.bottom, Platform.OS === 'android' ? 34 : 16) + 14,
                  },
                ]}
              >
                <View style={styles.footerStats}>
                  <Text style={[styles.footerLabel, { color: subtextColor }]} numberOfLines={1}>
                    {selectedStats.count > 0 ? 'Selected for cleaning' : 'Nothing selected'}
                  </Text>
                  <Text style={[styles.footerValue, { color: textColor }]} numberOfLines={1}>
                    {selectedStats.count > 0
                      ? `${selectedStats.count} files · ${formatFileSize(selectedStats.bytes)}`
                      : `Tap files or use Select ${activeCategory !== 'all' ? activeCategory.charAt(0).toUpperCase() + activeCategory.slice(1) + 's' : 'All'}`}
                  </Text>
                </View>
                <View style={styles.footerButtonsGroup}>
                  {selectedStats.count > 0 ? (
                    <TouchableOpacity
                      onPress={handleCancelSelection}
                      style={[styles.footerCancelBtn, { borderColor: border }]}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.footerCancelBtnText, { color: textColor }]}>
                        Deselect
                      </Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      onPress={onClose}
                      style={[styles.footerCancelBtn, { borderColor: border }]}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.footerCancelBtnText, { color: textColor }]}>Close</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    onPress={handleExecuteClean}
                    disabled={selectedStats.count === 0}
                    style={[
                      styles.cleanBtn,
                      {
                        backgroundColor: selectedStats.count > 0 ? '#EF4444' : border,
                        opacity: selectedStats.count > 0 ? 1 : 0.5,
                      },
                    ]}
                  >
                    <FontAwesome name="trash" size={15} color="#FFFFFF" style={{ marginRight: 8 }} />
                    <Text style={styles.cleanBtnText} numberOfLines={1}>
                      {selectedStats.count > 0
                        ? `Free Up ${formatFileSize(selectedStats.bytes)}`
                        : 'Free Up Space'}
                    </Text>
                  </TouchableOpacity>
                </View>
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
  noticeCard: {
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    gap: 4,
  },
  noticeItemText: {
    fontSize: 13,
    fontWeight: '600',
  },
  noticeSubtext: {
    fontSize: 12,
    lineHeight: 17,
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
  categoriesScroll: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingBottom: 10,
    gap: 8,
    alignItems: 'center',
  },
  catChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
  },
  catChipText: {
    fontSize: 12,
    fontWeight: '600',
  },
  catBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 10,
    marginLeft: 6,
  },
  catBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  emptyListMsg: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 36,
  },
  emptyListText: {
    fontSize: 14,
    textAlign: 'center',
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
  cancelCleaningBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 20,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    backgroundColor: 'rgba(239, 68, 68, 0.08)',
  },
  cancelCleaningBtnText: {
    color: '#EF4444',
    fontSize: 14,
    fontWeight: '600',
  },
  footerButtonsGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  footerCancelBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  footerCancelBtnText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
