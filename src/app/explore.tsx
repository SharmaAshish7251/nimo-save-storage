import React, { useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  FlatList,
  Image,
  Modal,
  ActivityIndicator,
  Alert,
  useColorScheme,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import * as Haptics from 'expo-haptics';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { router, useFocusEffect } from 'expo-router';
import {
  getUploadedIndex,
  UploadedRecord,
  getConfig,
  AppConfig,
  formatFileSize,
} from '@/lib/storage/queue';
import { getFileCategory } from '@/lib/scanner/files';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const GRID_COLUMNS = 3;
const GRID_ITEM_SIZE = (SCREEN_WIDTH - 32 - (GRID_COLUMNS - 1) * 8) / GRID_COLUMNS;

type CategoryFilter = 'all' | 'image' | 'video' | 'audio' | 'document';
type SortOption = 'newest' | 'oldest' | 'largest' | 'name';

interface CloudItem extends UploadedRecord {
  category: 'image' | 'video' | 'audio' | 'document' | 'other';
  existsLocally?: boolean;
}

export default function CloudExplorerScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  const [items, setItems] = useState<CloudItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<CategoryFilter>('all');
  const [sortOption, setSortOption] = useState<SortOption>('newest');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [selectedItem, setSelectedItem] = useState<CloudItem | null>(null);
  const [isSharing, setIsSharing] = useState(false);

  const loadCloudItems = useCallback(async () => {
    try {
      const [uploaded, appConfig] = await Promise.all([
        getUploadedIndex(),
        getConfig(),
      ]);
      setConfig(appConfig);

      // Verify local availability concurrently
      const mapped: CloudItem[] = await Promise.all(
        uploaded.map(async (rec) => {
          const category = getFileCategory(rec.fileName);
          let existsLocally = false;
          try {
            const info = await FileSystem.getInfoAsync(rec.uri);
            existsLocally = info.exists;
          } catch {
            existsLocally = false;
          }
          return {
            ...rec,
            category,
            existsLocally,
          };
        })
      );

      setItems(mapped);
    } catch (err) {
      console.warn('Failed to load cloud items:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadCloudItems();
    }, [loadCloudItems])
  );

  const totalCloudBytes = useMemo(() => {
    return items.reduce((acc, it) => acc + (it.size || 0), 0);
  }, [items]);

  const categoryCounts = useMemo(() => {
    const counts = { all: items.length, image: 0, video: 0, audio: 0, document: 0 };
    for (const it of items) {
      if (it.category in counts) {
        counts[it.category as keyof typeof counts] += 1;
      }
    }
    return counts;
  }, [items]);

  const filteredAndSortedItems = useMemo(() => {
    let result = items;

    // 1. Search Query Filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter((it) => it.fileName.toLowerCase().includes(q));
    }

    // 2. Category Filter
    if (activeCategory !== 'all') {
      result = result.filter((it) => it.category === activeCategory);
    }

    // 3. Sorting
    return [...result].sort((a, b) => {
      switch (sortOption) {
        case 'newest':
          return (b.uploadedAt || 0) - (a.uploadedAt || 0);
        case 'oldest':
          return (a.uploadedAt || 0) - (b.uploadedAt || 0);
        case 'largest':
          return (b.size || 0) - (a.size || 0);
        case 'name':
          return a.fileName.localeCompare(b.fileName);
        default:
          return 0;
      }
    });
  }, [items, searchQuery, activeCategory, sortOption]);

  const handleShareFile = async (item: CloudItem) => {
    if (!item.existsLocally) {
      Alert.alert(
        'Cloud-Only File',
        'This file was cleaned locally to free up device space. It remains securely backed up in your Telegram cloud.'
      );
      return;
    }

    setIsSharing(true);
    try {
      const canShare = await Sharing.isAvailableAsync();
      if (!canShare) {
        Alert.alert('Sharing Unavailable', 'File sharing is not supported on this device.');
        return;
      }
      await Sharing.shareAsync(item.uri);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (err: any) {
      Alert.alert('Share Error', err?.message || 'Failed to share file.');
    } finally {
      setIsSharing(false);
    }
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

  const bg = isDark ? '#0F172A' : '#F8FAFC';
  const cardBg = isDark ? '#1E293B' : '#FFFFFF';
  const textColor = isDark ? '#F8FAFC' : '#0F172A';
  const subtextColor = isDark ? '#94A3B8' : '#64748B';
  const border = isDark ? '#334155' : '#E2E8F0';

  const renderGridItem = ({ item }: { item: CloudItem }) => {
    const isImage = item.category === 'image';
    return (
      <TouchableOpacity
        style={[styles.gridCell, { backgroundColor: cardBg, borderColor: border }]}
        onPress={() => {
          Haptics.selectionAsync().catch(() => {});
          setSelectedItem(item);
        }}
        activeOpacity={0.8}
      >
        {isImage && item.existsLocally ? (
          <Image source={{ uri: item.uri }} style={styles.gridThumbImage} resizeMode="cover" />
        ) : (
          <View style={[styles.gridFallbackWrap, { backgroundColor: isDark ? '#1E293B' : '#F1F5F9' }]}>
            <FontAwesome
              name={getCategoryIcon(item.category) as any}
              size={28}
              color={item.category === 'image' ? '#10B981' : item.category === 'video' ? '#8B5CF6' : '#3B82F6'}
            />
            <Text style={[styles.gridFallbackText, { color: subtextColor }]} numberOfLines={1}>
              {item.fileName}
            </Text>
          </View>
        )}

        {/* Floating Size Pill */}
        <View style={styles.gridSizeBadge}>
          <Text style={styles.gridSizeText}>{formatFileSize(item.size)}</Text>
        </View>

        {/* Telegram Cloud Icon Badge */}
        <View style={styles.gridCloudBadge}>
          <FontAwesome name="telegram" size={10} color="#FFFFFF" />
        </View>
      </TouchableOpacity>
    );
  };

  const renderListItem = ({ item }: { item: CloudItem }) => {
    const isImage = item.category === 'image';
    return (
      <TouchableOpacity
        style={[styles.listRow, { backgroundColor: cardBg, borderColor: border }]}
        onPress={() => {
          Haptics.selectionAsync().catch(() => {});
          setSelectedItem(item);
        }}
        activeOpacity={0.7}
      >
        <View style={styles.listThumbWrap}>
          {isImage && item.existsLocally ? (
            <Image source={{ uri: item.uri }} style={styles.listThumbImage} />
          ) : (
            <View style={[styles.listIconBox, { backgroundColor: isDark ? '#334155' : '#EEF2FF' }]}>
              <FontAwesome
                name={getCategoryIcon(item.category) as any}
                size={18}
                color={item.category === 'image' ? '#10B981' : item.category === 'video' ? '#8B5CF6' : '#3B82F6'}
              />
            </View>
          )}
        </View>

        <View style={styles.listInfoWrap}>
          <Text style={[styles.listTitle, { color: textColor }]} numberOfLines={1}>
            {item.fileName}
          </Text>
          <View style={styles.listMetaRow}>
            <Text style={[styles.listSize, { color: subtextColor }]}>
              {formatFileSize(item.size)}
            </Text>
            <Text style={[styles.listDot, { color: subtextColor }]}>•</Text>
            <Text style={[styles.listDate, { color: subtextColor }]}>
              {new Date(item.uploadedAt).toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
              })}
            </Text>
            {item.telegramMessageId ? (
              <>
                <Text style={[styles.listDot, { color: subtextColor }]}>•</Text>
                <View style={styles.msgBadge}>
                  <Text style={styles.msgBadgeText}>#{item.telegramMessageId}</Text>
                </View>
              </>
            ) : null}
          </View>
        </View>

        <TouchableOpacity
          style={[styles.listActionBtn, { borderColor: border }]}
          onPress={() => handleShareFile(item)}
        >
          <FontAwesome name="share" size={12} color="#208AEF" />
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: bg }]} edges={['top', 'left', 'right']}>
      {/* Top App Header */}
      <View style={[styles.header, { borderBottomColor: border }]}>
        <View>
          <Text style={[styles.headerTitle, { color: textColor }]}>Cloud Explorer</Text>
          <Text style={[styles.headerSub, { color: subtextColor }]}>
            {items.length} files • {formatFileSize(totalCloudBytes)} in Telegram
          </Text>
        </View>
        <View style={styles.headerRightActions}>
          <TouchableOpacity
            style={[styles.viewModeBtn, { backgroundColor: cardBg, borderColor: border }]}
            onPress={() => {
              Haptics.selectionAsync().catch(() => {});
              setViewMode((m) => (m === 'grid' ? 'list' : 'grid'));
            }}
          >
            <FontAwesome
              name={viewMode === 'grid' ? 'list' : 'th'}
              size={14}
              color="#208AEF"
            />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.viewModeBtn, { backgroundColor: cardBg, borderColor: border }]}
            onPress={() => {
              Haptics.selectionAsync().catch(() => {});
              setSortOption((prev) =>
                prev === 'newest'
                  ? 'oldest'
                  : prev === 'oldest'
                  ? 'largest'
                  : prev === 'largest'
                  ? 'name'
                  : 'newest'
              );
            }}
          >
            <FontAwesome name="sort" size={14} color="#6366F1" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Search Input Bar */}
      <View style={styles.searchBarWrap}>
        <View style={[styles.searchBox, { backgroundColor: cardBg, borderColor: border }]}>
          <FontAwesome name="search" size={14} color="#94A3B8" style={{ marginRight: 8 }} />
          <TextInput
            style={[styles.searchInput, { color: textColor }]}
            placeholder="Search cloud media..."
            placeholderTextColor="#94A3B8"
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <FontAwesome name="times-circle" size={14} color="#94A3B8" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Category Filter Chips Carousel */}
      <View style={styles.categoryChipsBar}>
        {(['all', 'image', 'video', 'audio', 'document'] as CategoryFilter[]).map((cat) => {
          const isSelected = activeCategory === cat;
          const count = categoryCounts[cat] || 0;
          return (
            <TouchableOpacity
              key={cat}
              onPress={() => {
                Haptics.selectionAsync().catch(() => {});
                setActiveCategory(cat);
              }}
              style={[
                styles.categoryChip,
                {
                  backgroundColor: isSelected ? '#208AEF' : cardBg,
                  borderColor: isSelected ? '#208AEF' : border,
                },
              ]}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.categoryChipText,
                  { color: isSelected ? '#FFFFFF' : textColor },
                ]}
              >
                {cat === 'all'
                  ? 'All'
                  : cat === 'image'
                  ? 'Photos'
                  : cat.charAt(0).toUpperCase() + cat.slice(1)}{' '}
                ({count})
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Main Content Area */}
      {loading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#208AEF" />
          <Text style={[styles.loadingText, { color: subtextColor }]}>
            Indexing Telegram cloud media...
          </Text>
        </View>
      ) : filteredAndSortedItems.length === 0 ? (
        <View style={styles.emptyContainer}>
          <View style={styles.emptyIconBadge}>
            <FontAwesome name="cloud-upload" size={38} color="#208AEF" />
          </View>
          <Text style={[styles.emptyTitle, { color: textColor }]}>
            {searchQuery ? 'No Matching Files' : 'Cloud Storage is Empty'}
          </Text>
          <Text style={[styles.emptySubtitle, { color: subtextColor }]}>
            {searchQuery
              ? `No backed-up files matching "${searchQuery}".`
              : 'Files backed up by the auto-scheduler or upload queue will appear here in your personal cloud gallery.'}
          </Text>
          {!searchQuery && (
            <TouchableOpacity
              style={styles.emptyActionBtn}
              onPress={() => router.push('/upload')}
            >
              <FontAwesome name="plus" size={13} color="#FFFFFF" style={{ marginRight: 6 }} />
              <Text style={styles.emptyActionBtnText}>Go to Upload Queue</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : (
        <FlatList
          key={viewMode}
          data={filteredAndSortedItems}
          keyExtractor={(item) => item.uri}
          numColumns={viewMode === 'grid' ? GRID_COLUMNS : 1}
          contentContainerStyle={styles.listContent}
          renderItem={viewMode === 'grid' ? renderGridItem : renderListItem}
        />
      )}

      {/* Lightbox / Details Modal */}
      {selectedItem && (
        <Modal
          visible={true}
          transparent
          animationType="fade"
          onRequestClose={() => setSelectedItem(null)}
        >
          <View style={styles.modalBackdrop}>
            <View style={[styles.modalCard, { backgroundColor: cardBg }]}>
              {/* Modal Header */}
              <View style={[styles.modalHeader, { borderBottomColor: border }]}>
                <View style={styles.modalHeaderInfo}>
                  <Text style={[styles.modalTitle, { color: textColor }]} numberOfLines={1}>
                    {selectedItem.fileName}
                  </Text>
                  <Text style={[styles.modalSub, { color: subtextColor }]}>
                    {selectedItem.category.toUpperCase()} • {formatFileSize(selectedItem.size)}
                  </Text>
                </View>
                <TouchableOpacity
                  style={[styles.modalCloseBtn, { borderColor: border }]}
                  onPress={() => setSelectedItem(null)}
                >
                  <FontAwesome name="times" size={16} color={subtextColor} />
                </TouchableOpacity>
              </View>

              {/* Preview Box */}
              {selectedItem.category === 'image' && selectedItem.existsLocally ? (
                <View style={styles.lightboxImageWrap}>
                  <Image
                    source={{ uri: selectedItem.uri }}
                    style={styles.lightboxImage}
                    resizeMode="contain"
                  />
                </View>
              ) : (
                <View style={[styles.lightboxPlaceholder, { backgroundColor: isDark ? '#0F172A' : '#F1F5F9' }]}>
                  <FontAwesome
                    name={getCategoryIcon(selectedItem.category) as any}
                    size={48}
                    color="#208AEF"
                  />
                  <Text style={[styles.lightboxPlaceholderText, { color: subtextColor }]}>
                    {selectedItem.existsLocally ? 'Ready on Device' : 'Preserved in Telegram Cloud'}
                  </Text>
                </View>
              )}

              {/* Metadata Cards */}
              <View style={[styles.metadataCard, { backgroundColor: isDark ? '#0F172A' : '#F8FAFC', borderColor: border }]}>
                <View style={styles.metaRowBetween}>
                  <Text style={[styles.metaLabel, { color: subtextColor }]}>Telegram Destination</Text>
                  <Text style={[styles.metaVal, { color: textColor }]}>
                    {config?.targetChatTitle || 'Saved Messages'}
                  </Text>
                </View>
                <View style={[styles.metaDivider, { backgroundColor: border }]} />
                <View style={styles.metaRowBetween}>
                  <Text style={[styles.metaLabel, { color: subtextColor }]}>Cloud Message ID</Text>
                  <Text style={[styles.metaVal, { color: '#208AEF' }]}>
                    #{selectedItem.telegramMessageId || 'Confirmed'}
                  </Text>
                </View>
                <View style={[styles.metaDivider, { backgroundColor: border }]} />
                <View style={styles.metaRowBetween}>
                  <Text style={[styles.metaLabel, { color: subtextColor }]}>Uploaded Date</Text>
                  <Text style={[styles.metaVal, { color: textColor }]}>
                    {new Date(selectedItem.uploadedAt).toLocaleString()}
                  </Text>
                </View>
                <View style={[styles.metaDivider, { backgroundColor: border }]} />
                <View style={styles.metaRowBetween}>
                  <Text style={[styles.metaLabel, { color: subtextColor }]}>Local Device Copy</Text>
                  <View style={styles.localCopyPill}>
                    <FontAwesome
                      name={selectedItem.existsLocally ? 'check-circle' : 'cloud'}
                      size={11}
                      color={selectedItem.existsLocally ? '#10B981' : '#6366F1'}
                    />
                    <Text
                      style={[
                        styles.localCopyText,
                        { color: selectedItem.existsLocally ? '#10B981' : '#6366F1' },
                      ]}
                    >
                      {selectedItem.existsLocally ? 'Stored on Phone' : 'Freed from Phone (Cloud-only)'}
                    </Text>
                  </View>
                </View>
              </View>

              {/* Action Buttons */}
              <View style={styles.modalActionRow}>
                {selectedItem.existsLocally ? (
                  <TouchableOpacity
                    style={[styles.primaryActionBtn, { opacity: isSharing ? 0.6 : 1 }]}
                    onPress={() => handleShareFile(selectedItem)}
                    disabled={isSharing}
                  >
                    <FontAwesome name="share" size={14} color="#FFFFFF" style={{ marginRight: 8 }} />
                    <Text style={styles.primaryActionBtnText}>Share File</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    style={[styles.primaryActionBtn, { backgroundColor: '#10B981' }]}
                    onPress={() => {
                      Alert.alert(
                        'Cloud File Secured',
                        'This file is permanently stored in your Telegram Saved Messages / Channel cloud. You can also view or forward it directly via Telegram.'
                      );
                    }}
                  >
                    <FontAwesome name="check-circle" size={14} color="#FFFFFF" style={{ marginRight: 8 }} />
                    <Text style={styles.primaryActionBtnText}>Cloud Backed Up</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={[styles.secondaryActionBtn, { borderColor: border }]}
                  onPress={() => setSelectedItem(null)}
                >
                  <Text style={[styles.secondaryActionBtnText, { color: textColor }]}>Close</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '800',
  },
  headerSub: {
    fontSize: 12,
    marginTop: 2,
  },
  headerRightActions: {
    flexDirection: 'row',
    gap: 8,
  },
  viewModeBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchBarWrap: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    padding: 0,
  },
  categoryChipsBar: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingBottom: 10,
    gap: 8,
  },
  categoryChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
  },
  categoryChipText: {
    fontSize: 11,
    fontWeight: '600',
  },
  listContent: {
    padding: 16,
    paddingBottom: 40,
    gap: 8,
  },
  gridCell: {
    width: GRID_ITEM_SIZE,
    height: GRID_ITEM_SIZE,
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1,
    marginRight: 8,
    marginBottom: 8,
    position: 'relative',
  },
  gridThumbImage: {
    width: '100%',
    height: '100%',
  },
  gridFallbackWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 8,
  },
  gridFallbackText: {
    fontSize: 10,
    marginTop: 6,
    textAlign: 'center',
  },
  gridSizeBadge: {
    position: 'absolute',
    bottom: 4,
    left: 4,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
  },
  gridSizeText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '600',
  },
  gridCloudBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#208AEF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  listThumbWrap: {
    marginRight: 12,
  },
  listThumbImage: {
    width: 44,
    height: 44,
    borderRadius: 8,
  },
  listIconBox: {
    width: 44,
    height: 44,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listInfoWrap: {
    flex: 1,
  },
  listTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  listMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 3,
    gap: 6,
  },
  listSize: {
    fontSize: 12,
  },
  listDot: {
    fontSize: 12,
  },
  listDate: {
    fontSize: 12,
  },
  msgBadge: {
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  msgBadgeText: {
    fontSize: 10,
    color: '#208AEF',
    fontWeight: '700',
  },
  listActionBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  loadingText: {
    fontSize: 14,
    marginTop: 12,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 36,
  },
  emptyIconBadge: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: 'rgba(32, 138, 239, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 20,
  },
  emptyActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#208AEF',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
  },
  emptyActionBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    borderRadius: 20,
    padding: 16,
    maxHeight: '85%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  modalHeaderInfo: {
    flex: 1,
    marginRight: 12,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  modalSub: {
    fontSize: 11,
    marginTop: 2,
  },
  modalCloseBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lightboxImageWrap: {
    width: '100%',
    height: 220,
    marginVertical: 12,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#000000',
  },
  lightboxImage: {
    width: '100%',
    height: '100%',
  },
  lightboxPlaceholder: {
    width: '100%',
    height: 160,
    marginVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  lightboxPlaceholderText: {
    fontSize: 12,
    fontWeight: '600',
  },
  metadataCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    marginBottom: 16,
  },
  metaRowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  metaDivider: {
    height: 1,
    marginVertical: 4,
  },
  metaLabel: {
    fontSize: 12,
  },
  metaVal: {
    fontSize: 12,
    fontWeight: '600',
  },
  localCopyPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  localCopyText: {
    fontSize: 11,
    fontWeight: '600',
  },
  modalActionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  primaryActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#208AEF',
    paddingVertical: 12,
    borderRadius: 10,
  },
  primaryActionBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  secondaryActionBtn: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryActionBtnText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
