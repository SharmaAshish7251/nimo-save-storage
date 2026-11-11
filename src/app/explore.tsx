import React, { useState, useMemo, useCallback, useEffect } from 'react';
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
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import * as Haptics from 'expo-haptics';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library/legacy';
import { router, useFocusEffect } from 'expo-router';
import {
  getUploadedIndex,
  UploadedRecord,
  getConfig,
  AppConfig,
  formatFileSize,
  addToQueue,
  removeUploadedRecord,
} from '@/lib/storage/queue';
import { getFileCategory } from '@/lib/scanner/files';
import {
  reconcileCloudIndex,
  deleteCloudRecord,
  importFromTelegramHistory,
  startRealtimeDeleteListener,
} from '@/lib/storage/cloudSync';
import { tdLibClient } from '@/lib/tdlib/client';
import { reassembleChunks } from '@/lib/storage/reassembler';
import { MediaPlayerModal, MediaPreviewItem } from '@/components/MediaPlayerModal';
import { vaultService } from '@/lib/crypto/vault';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const GRID_COLUMNS = 3;
const GRID_ITEM_SIZE = (SCREEN_WIDTH - 32 - (GRID_COLUMNS - 1) * 8) / GRID_COLUMNS;

type CategoryFilter = 'all' | 'image' | 'video' | 'audio' | 'document' | 'missing';
type SortOption = 'newest' | 'oldest' | 'largest' | 'name';

interface CloudItem extends UploadedRecord {
  category: 'image' | 'video' | 'audio' | 'document' | 'other';
  existsLocally?: boolean;
}

function getRestoredCachePath(fileName: string, id: string | number): string {
  return `${FileSystem.cacheDirectory}restored_${id}_${fileName}`;
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
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isDeletingCloud, setIsDeletingCloud] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [downloadingItemUri, setDownloadingItemUri] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<number>(0);
  const [downloadStatusText, setDownloadStatusText] = useState<string>('');
  const [mediaPlayerItem, setMediaPlayerItem] = useState<MediaPreviewItem | null>(null);

  // Multi-select & Bulk actions state
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedUris, setSelectedUris] = useState<Set<string>>(new Set());
  const [isBulkOperating, setIsBulkOperating] = useState(false);
  const [bulkStatusText, setBulkStatusText] = useState('');

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

  // Attach live Telegram delete listener
  useEffect(() => {
    const unsub = startRealtimeDeleteListener(() => {
      loadCloudItems();
    });
    return unsub;
  }, [loadCloudItems]);

  const handlePullToRefresh = async () => {
    setIsRefreshing(true);
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      const res = await reconcileCloudIndex({ forceAll: true });
      await loadCloudItems();
      if (res.missing > 0) {
        Alert.alert(
          'Reconciliation Complete',
          `Checked ${res.total} file(s). Found ${res.missing} file(s) deleted in Telegram Cloud.`
        );
      }
    } catch (err: any) {
      console.warn('Refresh error:', err);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleDeleteFromCloud = (item: CloudItem) => {
    Alert.alert(
      'Delete from Telegram Cloud?',
      `Are you sure you want to permanently delete "${item.fileName}" from Telegram servers?\n\nThis cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete from Cloud',
          style: 'destructive',
          onPress: async () => {
            setIsDeletingCloud(true);
            try {
              await deleteCloudRecord(item);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
              setSelectedItem(null);
              await loadCloudItems();
            } catch (err: any) {
              Alert.alert('Delete Failed', err?.message || 'Could not delete from Telegram.');
            } finally {
              setIsDeletingCloud(false);
            }
          },
        },
      ]
    );
  };

  const handleReuploadMissing = async (item: CloudItem) => {
    try {
      if (!item.existsLocally) {
        Alert.alert('Cannot Re-upload', 'The local file copy does not exist on this device.');
        return;
      }
      await addToQueue({
        uri: item.uri,
        fileName: item.fileName,
        size: item.size,
      });
      await removeUploadedRecord(item.uri);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      Alert.alert(
        'Queued for Upload',
        `"${item.fileName}" has been re-added to your upload queue.`,
        [
          { text: 'Go to Queue', onPress: () => router.push('/upload') },
          { text: 'OK', style: 'default' },
        ]
      );
      setSelectedItem(null);
      await loadCloudItems();
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to re-queue file.');
    }
  };

  const handleRemoveStaleRecord = async (item: CloudItem) => {
    try {
      await removeUploadedRecord(item.uri);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setSelectedItem(null);
      await loadCloudItems();
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to remove record.');
    }
  };

  const handleImportFromTelegram = () => {
    Alert.alert(
      'Sync Telegram Cloud History',
      'Scan your backup destination in Telegram to discover and import existing files into Cloud Explorer?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Scan Cloud',
          onPress: async () => {
            setIsImporting(true);
            try {
              const res = await importFromTelegramHistory({ limit: 150 });
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
              await loadCloudItems();
              Alert.alert(
                'Sync Finished',
                `Scanned ${res.totalFound} messages and imported ${res.imported} new cloud file(s) into your catalog.`
              );
            } catch (err: any) {
              Alert.alert('Sync Error', err?.message || 'Failed to scan Telegram history.');
            } finally {
              setIsImporting(false);
            }
          },
        },
      ]
    );
  };

  const totalCloudBytes = useMemo(() => {
    return items.reduce((acc, it) => acc + (it.size || 0), 0);
  }, [items]);

  const categoryCounts = useMemo(() => {
    const counts = { all: items.length, image: 0, video: 0, audio: 0, document: 0, missing: 0 };
    for (const it of items) {
      if (it.category in counts) {
        counts[it.category as keyof typeof counts] += 1;
      }
      if (it.cloudStatus === 'missing') {
        counts.missing += 1;
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
    if (activeCategory === 'missing') {
      result = result.filter((it) => it.cloudStatus === 'missing');
    } else if (activeCategory !== 'all') {
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

  const toggleSelection = (uri: string) => {
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

  const exitSelectMode = () => {
    setIsSelectMode(false);
    setSelectedUris(new Set());
  };

  const handleItemPress = (item: CloudItem) => {
    if (isSelectMode) {
      Haptics.selectionAsync().catch(() => {});
      toggleSelection(item.uri);
    } else {
      Haptics.selectionAsync().catch(() => {});
      setSelectedItem(item);
    }
  };

  const handleItemLongPress = (item: CloudItem) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    if (!isSelectMode) {
      setIsSelectMode(true);
      setSelectedUris(new Set([item.uri]));
    } else {
      toggleSelection(item.uri);
    }
  };

  const selectedItemsList = useMemo(() => {
    return items.filter((it) => selectedUris.has(it.uri));
  }, [items, selectedUris]);

  const selectedTotalBytes = useMemo(() => {
    return selectedItemsList.reduce(
      (acc, it) => acc + (it.chunkManifest ? it.chunkManifest.originalSize : it.size),
      0
    );
  }, [selectedItemsList]);

  const handleSelectAll = () => {
    Haptics.selectionAsync().catch(() => {});
    if (selectedUris.size === filteredAndSortedItems.length) {
      setSelectedUris(new Set());
    } else {
      setSelectedUris(new Set(filteredAndSortedItems.map((it) => it.uri)));
    }
  };

  const handleBulkDownload = async () => {
    if (selectedItemsList.length === 0) return;
    Alert.alert(
      'Download to Device',
      `Download ${selectedItemsList.length} file(s) (${formatFileSize(selectedTotalBytes)}) to your device storage?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Download',
          onPress: async () => {
            setIsBulkOperating(true);
            let downloadedCount = 0;
            try {
              for (let i = 0; i < selectedItemsList.length; i++) {
                const it = selectedItemsList[i];
                setBulkStatusText(`Downloading ${i + 1} of ${selectedItemsList.length}: ${it.fileName}...`);
                const localUri = await downloadCloudItemToLocal(it);
                if (it.category === 'image' || it.category === 'video') {
                  const perm = await MediaLibrary.requestPermissionsAsync().catch(() => ({ status: 'denied' }));
                  if (perm.status === 'granted') {
                    await MediaLibrary.createAssetAsync(localUri).catch(() => {});
                  }
                }
                downloadedCount++;
              }
              Alert.alert('Download Complete ✓', `Saved ${downloadedCount} file(s) to device.`);
              exitSelectMode();
              await loadCloudItems();
            } catch (err: any) {
              Alert.alert('Download Error', err?.message || 'Failed during bulk download.');
            } finally {
              setIsBulkOperating(false);
              setBulkStatusText('');
            }
          },
        },
      ]
    );
  };

  const handleBulkShare = async () => {
    if (selectedItemsList.length === 0) return;
    setIsBulkOperating(true);
    setBulkStatusText('Preparing files for sharing...');
    try {
      if (selectedItemsList.length === 1) {
        await handleShareFile(selectedItemsList[0]);
        exitSelectMode();
        return;
      }
      const localUris: string[] = [];
      for (let i = 0; i < selectedItemsList.length; i++) {
        const it = selectedItemsList[i];
        setBulkStatusText(`Preparing ${i + 1} of ${selectedItemsList.length}...`);
        const uri = await downloadCloudItemToLocal(it);
        localUris.push(uri);
      }
      if (localUris.length > 0) {
        await Sharing.shareAsync(localUris[0]);
      }
      exitSelectMode();
    } catch (err: any) {
      Alert.alert('Share Error', err?.message || 'Could not prepare files to share.');
    } finally {
      setIsBulkOperating(false);
      setBulkStatusText('');
    }
  };

  const handleBulkDelete = async () => {
    if (selectedItemsList.length === 0) return;
    Alert.alert(
      'Delete from Telegram Cloud',
      `Are you sure you want to delete ${selectedItemsList.length} file(s) from your Telegram cloud storage? This action cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setIsBulkOperating(true);
            setBulkStatusText(`Deleting ${selectedItemsList.length} items from cloud...`);
            try {
              for (const it of selectedItemsList) {
                await deleteCloudRecord(it);
              }
              exitSelectMode();
              await loadCloudItems();
              Alert.alert('Deleted', `Removed ${selectedItemsList.length} file(s) from cloud catalog.`);
            } catch (err: any) {
              Alert.alert('Delete Error', err?.message || 'Failed to delete some items.');
            } finally {
              setIsBulkOperating(false);
              setBulkStatusText('');
            }
          },
        },
      ]
    );
  };

  const downloadCloudItemToLocal = async (item: CloudItem): Promise<string> => {
    if (item.existsLocally) {
      const info = await FileSystem.getInfoAsync(item.uri).catch(() => ({ exists: false }));
      if (info.exists) return item.uri;
    }

    const chatId = await tdLibClient.resolveTargetChatId(config?.targetChatId || 'me');

    // Case A: Multi-Part Chunked File
    if (item.chunkManifest && item.chunkManifest.parts.length > 0) {
      setDownloadStatusText(`Downloading chunked file (0/${item.chunkManifest.parts.length})...`);
      const downloadedPartUris: string[] = [];

      for (let i = 0; i < item.chunkManifest.parts.length; i++) {
        const part = item.chunkManifest.parts[i];
        if (!part.telegramMessageId) {
          throw new Error(`Part ${i + 1} has no Telegram message ID.`);
        }
        setDownloadStatusText(`Downloading part ${i + 1} of ${item.chunkManifest.parts.length}...`);
        const partLocalPath = await tdLibClient.downloadMessageFile(
          chatId,
          part.telegramMessageId,
          (progress) => {
            const overall = (i + progress) / item.chunkManifest!.parts.length;
            setDownloadProgress(overall);
          }
        );
        downloadedPartUris.push(`file://${partLocalPath}`);
      }

      setDownloadStatusText('Reassembling multi-part file...');
      const reassembledDest = getRestoredCachePath(item.fileName, item.uploadedAt || item.telegramMessageId || 1);
      await reassembleChunks(downloadedPartUris, reassembledDest, (pct) => {
        setDownloadProgress(pct / 100);
      });
      return reassembledDest;
    }

    // Case B: Single file
    if (!item.telegramMessageId) {
      throw new Error('This file has no recorded Telegram message ID to download from.');
    }

    setDownloadStatusText('Downloading from Telegram cloud...');
    const localPath = await tdLibClient.downloadMessageFile(
      chatId,
      item.telegramMessageId,
      (progress, downloaded, total) => {
        setDownloadProgress(progress);
        setDownloadStatusText(
          `Downloading (${formatFileSize(downloaded)} / ${formatFileSize(total)})...`
        );
      }
    );

    const finalUri = localPath.startsWith('file://') ? localPath : `file://${localPath}`;

    // Transparently decrypt zero-knowledge vault files
    const isEncrypted = await vaultService.isEncryptedFile(finalUri).catch(() => false);
    if (isEncrypted) {
      setDownloadStatusText('Decrypting zero-knowledge vault file...');
      const decryptedPath = getRestoredCachePath(`dec_${item.fileName}`, item.uploadedAt || 1);
      await vaultService.decryptFile(finalUri, decryptedPath);
      return decryptedPath;
    }

    return finalUri;
  };

  const handleDownloadToDevice = async (item: CloudItem) => {
    if (downloadingItemUri) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setDownloadingItemUri(item.uri);
    setDownloadProgress(0);
    setDownloadStatusText('Connecting to Telegram cloud...');

    try {
      const localUri = await downloadCloudItemToLocal(item);

      // Save to MediaLibrary if image or video
      if (item.category === 'image' || item.category === 'video') {
        const { status } = await MediaLibrary.requestPermissionsAsync();
        if (status === MediaLibrary.PermissionStatus.GRANTED) {
          await MediaLibrary.createAssetAsync(localUri);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          Alert.alert(
            'Saved to Device Gallery! 🎉',
            `"${item.fileName}" has been downloaded and saved directly into your device Photos/Gallery.`
          );
        } else {
          await Sharing.shareAsync(localUri);
        }
      } else {
        await Sharing.shareAsync(localUri);
      }

      // Mark locally exists in state
      setItems((prev) =>
        prev.map((it) => (it.uri === item.uri ? { ...it, existsLocally: true } : it))
      );
      if (selectedItem?.uri === item.uri) {
        setSelectedItem((prev) => (prev ? { ...prev, existsLocally: true } : null));
      }
      if (mediaPlayerItem?.uri === item.uri) {
        setMediaPlayerItem((prev) => (prev ? { ...prev, existsLocally: true } : null));
      }
    } catch (err: any) {
      Alert.alert('Download Failed', err?.message || 'Could not download file from Telegram.');
    } finally {
      setDownloadingItemUri(null);
      setDownloadProgress(0);
      setDownloadStatusText('');
    }
  };

  const handleShareFile = async (item: CloudItem) => {
    setIsSharing(true);
    setDownloadingItemUri(item.uri);
    setDownloadProgress(0);
    setDownloadStatusText('Preparing file to share...');

    try {
      const canShare = await Sharing.isAvailableAsync();
      if (!canShare) {
        Alert.alert('Sharing Unavailable', 'File sharing is not supported on this device.');
        return;
      }

      let shareUri = item.uri;
      if (!item.existsLocally) {
        shareUri = await downloadCloudItemToLocal(item);
      }

      await Sharing.shareAsync(shareUri);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (err: any) {
      Alert.alert('Share Error', err?.message || 'Failed to share file.');
    } finally {
      setIsSharing(false);
      setDownloadingItemUri(null);
      setDownloadProgress(0);
      setDownloadStatusText('');
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
    const isSelected = selectedUris.has(item.uri);
    return (
      <TouchableOpacity
        style={[
          styles.gridCell,
          { backgroundColor: cardBg, borderColor: border },
          isSelected && styles.gridCellSelected,
        ]}
        onPress={() => handleItemPress(item)}
        onLongPress={() => handleItemLongPress(item)}
        delayLongPress={300}
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
          <Text style={styles.gridSizeText}>{formatFileSize(item.chunkManifest ? item.chunkManifest.originalSize : item.size)}</Text>
        </View>

        {/* Split badge for multi-part files */}
        {item.chunkManifest ? (
          <View style={styles.gridSplitBadge}>
            <FontAwesome name="puzzle-piece" size={8} color="#FFFFFF" />
            <Text style={styles.gridSplitText}> {item.chunkManifest.totalParts}p</Text>
          </View>
        ) : null}

        {/* Telegram Cloud Icon Badge / Missing Warning Badge */}
        <View
          style={[
            styles.gridCloudBadge,
            item.cloudStatus === 'missing' && { backgroundColor: '#EF4444' },
          ]}
        >
          <FontAwesome
            name={item.cloudStatus === 'missing' ? 'exclamation' : 'telegram'}
            size={10}
            color="#FFFFFF"
          />
        </View>

        {/* Multi-Select Checkmark Circle */}
        {isSelectMode && (
          <View
            style={[
              styles.gridSelectCircle,
              isSelected && styles.gridSelectCircleActive,
            ]}
          >
            {isSelected && <FontAwesome name="check" size={10} color="#FFFFFF" />}
          </View>
        )}
      </TouchableOpacity>
    );
  };

  const renderListItem = ({ item }: { item: CloudItem }) => {
    const isImage = item.category === 'image';
    const isSelected = selectedUris.has(item.uri);
    return (
      <TouchableOpacity
        style={[
          styles.listRow,
          { backgroundColor: cardBg, borderColor: border },
          isSelected && styles.listRowSelected,
        ]}
        onPress={() => handleItemPress(item)}
        onLongPress={() => handleItemLongPress(item)}
        delayLongPress={300}
        activeOpacity={0.7}
      >
        {isSelectMode && (
          <View
            style={[
              styles.listSelectCircle,
              isSelected && styles.listSelectCircleActive,
            ]}
          >
            {isSelected && <FontAwesome name="check" size={10} color="#FFFFFF" />}
          </View>
        )}

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
              {formatFileSize(item.chunkManifest ? item.chunkManifest.originalSize : item.size)}
            </Text>
            <Text style={[styles.listDot, { color: subtextColor }]}>•</Text>
            <Text style={[styles.listDate, { color: subtextColor }]}>
              {new Date(item.uploadedAt).toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
              })}
            </Text>
            {item.chunkManifest ? (
              <>
                <Text style={[styles.listDot, { color: subtextColor }]}>•</Text>
                <View style={[styles.msgBadge, { backgroundColor: '#F59E0B' }]}>
                  <Text style={styles.msgBadgeText}>{item.chunkManifest.totalParts} parts</Text>
                </View>
              </>
            ) : null}
            {item.cloudStatus === 'missing' ? (
              <>
                <Text style={[styles.listDot, { color: subtextColor }]}>•</Text>
                <View style={[styles.msgBadge, { backgroundColor: '#EF4444' }]}>
                  <Text style={styles.msgBadgeText}>Missing in TG</Text>
                </View>
              </>
            ) : item.telegramMessageId && !item.chunkManifest ? (
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
      {/* Top App Header / Selection Header */}
      {isSelectMode ? (
        <View style={[styles.selectModeHeader, { backgroundColor: cardBg, borderBottomColor: border }]}>
          <TouchableOpacity onPress={exitSelectMode} style={styles.selectCloseBtn}>
            <FontAwesome name="times" size={16} color={textColor} />
          </TouchableOpacity>
          <View style={styles.selectCountWrap}>
            <Text style={[styles.selectCountText, { color: textColor }]}>
              {selectedUris.size} selected
            </Text>
            <Text style={[styles.selectSizeText, { color: subtextColor }]}>
              ({formatFileSize(selectedTotalBytes)})
            </Text>
          </View>
          <TouchableOpacity onPress={handleSelectAll} style={styles.selectAllBtn}>
            <Text style={styles.selectAllBtnText}>
              {selectedUris.size === filteredAndSortedItems.length && filteredAndSortedItems.length > 0
                ? 'Deselect All'
                : 'Select All'}
            </Text>
          </TouchableOpacity>
        </View>
      ) : (
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
              onPress={handleImportFromTelegram}
              disabled={isImporting}
            >
              {isImporting ? (
                <ActivityIndicator size="small" color="#10B981" />
              ) : (
                <FontAwesome name="cloud-download" size={14} color="#10B981" />
              )}
            </TouchableOpacity>
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
      )}

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
        {(['all', 'image', 'video', 'audio', 'document', 'missing'] as CategoryFilter[]).map((cat) => {
          if (cat === 'missing' && categoryCounts.missing === 0) return null;
          const isSelected = activeCategory === cat;
          const isMissingCat = cat === 'missing';
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
                  backgroundColor: isSelected
                    ? isMissingCat
                      ? '#EF4444'
                      : '#208AEF'
                    : cardBg,
                  borderColor: isSelected
                    ? isMissingCat
                      ? '#EF4444'
                      : '#208AEF'
                    : isMissingCat
                    ? '#EF4444'
                    : border,
                },
              ]}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.categoryChipText,
                  {
                    color: isSelected
                      ? '#FFFFFF'
                      : isMissingCat
                      ? '#EF4444'
                      : textColor,
                    fontWeight: isMissingCat ? '700' : '500',
                  },
                ]}
              >
                {cat === 'all'
                  ? 'All'
                  : cat === 'image'
                  ? 'Photos'
                  : cat === 'missing'
                  ? '⚠️ Missing'
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
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handlePullToRefresh}
              tintColor="#208AEF"
            />
          }
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

              {/* Missing Warning Banner */}
              {selectedItem.cloudStatus === 'missing' && (
                <View style={styles.missingBanner}>
                  <FontAwesome name="exclamation-triangle" size={16} color="#EF4444" />
                  <Text style={styles.missingBannerText}>
                    This file was deleted in Telegram. Its cloud copy is no longer reachable.
                    {selectedItem.existsLocally
                      ? ' Since you still have a local copy, tap "Re-upload to Cloud" to restore it.'
                      : ' Tap "Remove from List" to clean this entry.'}
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
                <View style={[styles.metaDivider, { backgroundColor: border }]} />
                <View style={styles.metaRowBetween}>
                  <Text style={[styles.metaLabel, { color: subtextColor }]}>Cloud Status</Text>
                  <View style={styles.localCopyPill}>
                    <FontAwesome
                      name={selectedItem.cloudStatus === 'missing' ? 'exclamation-circle' : 'check-circle'}
                      size={11}
                      color={selectedItem.cloudStatus === 'missing' ? '#EF4444' : '#10B981'}
                    />
                    <Text
                      style={[
                        styles.localCopyText,
                        { color: selectedItem.cloudStatus === 'missing' ? '#EF4444' : '#10B981' },
                      ]}
                    >
                      {selectedItem.cloudStatus === 'missing' ? 'Deleted from Telegram' : 'Active in Telegram'}
                    </Text>
                  </View>
                </View>
              </View>

              {/* Action Buttons */}
              <View style={styles.modalActionRow}>
                {selectedItem.cloudStatus === 'missing' ? (
                  <>
                    {selectedItem.existsLocally ? (
                      <TouchableOpacity
                        style={[styles.primaryActionBtn, { backgroundColor: '#208AEF' }]}
                        onPress={() => handleReuploadMissing(selectedItem)}
                      >
                        <FontAwesome name="cloud-upload" size={14} color="#FFFFFF" style={{ marginRight: 8 }} />
                        <Text style={styles.primaryActionBtnText}>Re-upload to Cloud</Text>
                      </TouchableOpacity>
                    ) : (
                      <TouchableOpacity
                        style={[styles.primaryActionBtn, { backgroundColor: '#64748B' }]}
                        onPress={() => handleRemoveStaleRecord(selectedItem)}
                      >
                        <FontAwesome name="trash" size={14} color="#FFFFFF" style={{ marginRight: 8 }} />
                        <Text style={styles.primaryActionBtnText}>Remove from List</Text>
                      </TouchableOpacity>
                    )}
                  </>
                ) : (
                  <>
                    <TouchableOpacity
                      style={[
                        styles.primaryActionBtn,
                        { backgroundColor: '#10B981', opacity: downloadingItemUri !== null ? 0.6 : 1 },
                      ]}
                      onPress={() => handleDownloadToDevice(selectedItem)}
                      disabled={downloadingItemUri !== null}
                    >
                      {downloadingItemUri === selectedItem.uri ? (
                        <ActivityIndicator size="small" color="#FFFFFF" style={{ marginRight: 6 }} />
                      ) : (
                        <FontAwesome
                          name={selectedItem.existsLocally ? 'check-circle' : 'download'}
                          size={14}
                          color="#FFFFFF"
                          style={{ marginRight: 6 }}
                        />
                      )}
                      <Text style={styles.primaryActionBtnText}>
                        {downloadingItemUri === selectedItem.uri
                          ? `${Math.round(downloadProgress * 100)}%`
                          : selectedItem.existsLocally
                          ? 'Save to Gallery'
                          : 'Download'}
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[
                        styles.primaryActionBtn,
                        { backgroundColor: '#208AEF', opacity: isSharing ? 0.6 : 1 },
                      ]}
                      onPress={() => handleShareFile(selectedItem)}
                      disabled={isSharing || downloadingItemUri !== null}
                    >
                      <FontAwesome name="share" size={13} color="#FFFFFF" style={{ marginRight: 6 }} />
                      <Text style={styles.primaryActionBtnText}>Share</Text>
                    </TouchableOpacity>

                    {(selectedItem.category === 'image' || selectedItem.category === 'video' || selectedItem.category === 'audio') && (
                      <TouchableOpacity
                        style={[styles.primaryActionBtn, { backgroundColor: '#6366F1' }]}
                        onPress={() => {
                          const it = selectedItem;
                          setSelectedItem(null);
                          setMediaPlayerItem(it);
                        }}
                      >
                        <FontAwesome name="play" size={12} color="#FFFFFF" style={{ marginRight: 6 }} />
                        <Text style={styles.primaryActionBtnText}>View</Text>
                      </TouchableOpacity>
                    )}

                    <TouchableOpacity
                      style={[styles.dangerActionBtn, { opacity: isDeletingCloud ? 0.6 : 1 }]}
                      onPress={() => handleDeleteFromCloud(selectedItem)}
                      disabled={isDeletingCloud}
                    >
                      {isDeletingCloud ? (
                        <ActivityIndicator size="small" color="#EF4444" />
                      ) : (
                        <FontAwesome name="trash-o" size={14} color="#EF4444" />
                      )}
                    </TouchableOpacity>
                  </>
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

      {/* Full-Screen Media Player Lightbox */}
      <MediaPlayerModal
        visible={mediaPlayerItem !== null}
        item={mediaPlayerItem}
        onClose={() => setMediaPlayerItem(null)}
        onShare={(item) => handleShareFile(item as CloudItem)}
        onDownload={(item) => handleDownloadToDevice(item as CloudItem)}
        isDownloading={downloadingItemUri !== null}
        downloadProgress={downloadProgress}
        downloadStatusText={downloadStatusText}
      />

      {/* Floating Bulk Action Bar */}
      {isSelectMode && selectedUris.size > 0 && (
        <View style={[styles.bulkActionBar, { backgroundColor: cardBg, borderColor: border }]}>
          <TouchableOpacity
            style={styles.bulkActionBtn}
            onPress={handleBulkDownload}
            disabled={isBulkOperating}
          >
            <FontAwesome name="download" size={16} color="#208AEF" />
            <Text style={[styles.bulkActionText, { color: '#208AEF' }]}>Download ({selectedUris.size})</Text>
          </TouchableOpacity>

          <View style={[styles.bulkDivider, { backgroundColor: border }]} />

          <TouchableOpacity
            style={styles.bulkActionBtn}
            onPress={handleBulkShare}
            disabled={isBulkOperating}
          >
            <FontAwesome name="share" size={16} color="#208AEF" />
            <Text style={[styles.bulkActionText, { color: '#208AEF' }]}>Share</Text>
          </TouchableOpacity>

          <View style={[styles.bulkDivider, { backgroundColor: border }]} />

          <TouchableOpacity
            style={styles.bulkActionBtn}
            onPress={handleBulkDelete}
            disabled={isBulkOperating}
          >
            <FontAwesome name="trash" size={16} color="#EF4444" />
            <Text style={[styles.bulkActionText, { color: '#EF4444' }]}>Delete</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Bulk Progress Toast / Overlay */}
      {isBulkOperating && (
        <View style={styles.bulkProgressOverlay}>
          <ActivityIndicator size="small" color="#FFFFFF" style={{ marginRight: 8 }} />
          <Text style={styles.bulkProgressText}>{bulkStatusText}</Text>
        </View>
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
  gridSplitBadge: {
    position: 'absolute',
    top: 4,
    left: 4,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F59E0B',
    borderRadius: 6,
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  gridSplitText: {
    color: '#FFFFFF',
    fontSize: 8,
    fontWeight: '700',
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
  dangerActionBtn: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#FCA5A5',
    backgroundColor: 'rgba(239, 68, 68, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  missingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderColor: 'rgba(239, 68, 68, 0.3)',
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    marginBottom: 12,
    gap: 8,
  },
  missingBannerText: {
    flex: 1,
    fontSize: 12,
    color: '#EF4444',
    lineHeight: 16,
  },
  // Multi-Select Styles
  selectModeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  selectCloseBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectCountWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  selectCountText: {
    fontSize: 16,
    fontWeight: '700',
  },
  selectSizeText: {
    fontSize: 13,
  },
  selectAllBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#EFF6FF',
  },
  selectAllBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#208AEF',
  },
  gridCellSelected: {
    borderColor: '#208AEF',
    borderWidth: 2,
  },
  gridSelectCircle: {
    position: 'absolute',
    top: 6,
    left: 6,
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.8)',
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  gridSelectCircleActive: {
    backgroundColor: '#208AEF',
    borderColor: '#FFFFFF',
  },
  listRowSelected: {
    borderColor: '#208AEF',
    borderWidth: 1.5,
    backgroundColor: 'rgba(32, 138, 239, 0.05)',
  },
  listSelectCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  listSelectCircleActive: {
    backgroundColor: '#208AEF',
    borderColor: '#208AEF',
  },
  bulkActionBar: {
    position: 'absolute',
    bottom: 24,
    left: 20,
    right: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 16,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 8,
  },
  bulkActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  bulkActionText: {
    fontSize: 13,
    fontWeight: '700',
  },
  bulkDivider: {
    width: 1,
    height: 20,
  },
  bulkProgressOverlay: {
    position: 'absolute',
    bottom: 90,
    alignSelf: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.9)',
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 10,
  },
  bulkProgressText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
});
