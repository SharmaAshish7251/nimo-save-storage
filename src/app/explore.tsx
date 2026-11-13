import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  FlatList,
  ScrollView,
  Image,
  Modal,
  ActivityIndicator,
  Alert,
  Dimensions,
  RefreshControl,
  Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '@/context/ThemeContext';
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
  isRecordInMultiStream,
} from '@/lib/storage/queue';
import { getFileCategory } from '@/lib/scanner/files';
import { resolveLocalFileTarget } from '@/lib/storage/fileHelper';
import {
  reconcileCloudIndex,
  deleteCloudRecord,
  importFromTelegramHistory,
  startRealtimeDeleteListener,
} from '@/lib/storage/cloudSync';
import { tdLibClient } from '@/lib/tdlib/client';
import { ensureFileSchemeUri, getMimeTypeFromFileName } from '@/lib/tdlib/fileHelper';
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
  cachedLocalUri?: string;
}

function getRestoredCachePath(fileName: string, id: string | number): string {
  return `${FileSystem.cacheDirectory}restored_${id}_${fileName}`;
}

export default function CloudExplorerScreen() {
  const insets = useSafeAreaInsets();
  const { isDark } = useAppTheme();

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

  // Stream View Scope: 'current' (current device backup) vs 'all' (all cloud files in stream channels)
  const [streamScope, setStreamScope] = useState<'current' | 'all'>('current');

  const loadCloudItems = useCallback(async () => {
    try {
      const [uploaded, appConfig] = await Promise.all([
        getUploadedIndex(),
        getConfig(),
      ]);
      setConfig(appConfig);

      let relevantRecords: UploadedRecord[] = [];
      const streamChannelIds = new Set<string>();

      if (appConfig?.multiChannelRouting) {
        const [resolvedPhotoId, resolvedVideoId, resolvedDocId] = await Promise.all([
          appConfig.photoChannelId ? tdLibClient.resolveTargetChatId(appConfig.photoChannelId).catch(() => null) : null,
          appConfig.videoChannelId ? tdLibClient.resolveTargetChatId(appConfig.videoChannelId).catch(() => null) : null,
          appConfig.documentChannelId ? tdLibClient.resolveTargetChatId(appConfig.documentChannelId).catch(() => null) : null,
        ]);
        if (resolvedPhotoId) streamChannelIds.add(String(resolvedPhotoId));
        if (resolvedVideoId) streamChannelIds.add(String(resolvedVideoId));
        if (resolvedDocId) streamChannelIds.add(String(resolvedDocId));

        // Strict multi-stream filtering: completely excludes Saved Messages records
        relevantRecords = uploaded.filter((rec) =>
          isRecordInMultiStream(rec, appConfig, streamChannelIds)
        );
      } else {
        relevantRecords = uploaded;
      }

      // Verify local availability concurrently
      const mapped: CloudItem[] = await Promise.all(
        relevantRecords.map(async (rec) => {
          const category = getFileCategory(rec.fileName);
          let destinationTitle = rec.destinationTitle;

          if (appConfig?.multiChannelRouting) {
            const streamTitles = new Set([
              (appConfig.photoChannelTitle || '').toLowerCase().trim(),
              (appConfig.videoChannelTitle || '').toLowerCase().trim(),
              (appConfig.documentChannelTitle || '').toLowerCase().trim(),
            ]);
            if (!destinationTitle || !streamTitles.has(destinationTitle.toLowerCase().trim())) {
              if (category === 'image') {
                destinationTitle = appConfig.photoChannelTitle || 'Photos Channel';
              } else if (category === 'video') {
                destinationTitle = appConfig.videoChannelTitle || 'Videos Channel';
              } else {
                destinationTitle = appConfig.documentChannelTitle || 'Documents Channel';
              }
            }
          } else {
            if (!destinationTitle) {
              destinationTitle =
                appConfig?.uploadToSavedMessages || !appConfig?.targetChatId
                  ? 'Saved Messages'
                  : appConfig.targetChatTitle || 'Target Channel';
            }
          }

          let existsLocally = false;
          let resolvedLocalUri = rec.uri;
          try {
            const target = await resolveLocalFileTarget({
              uri: rec.uri,
              fileName: rec.fileName,
              size: rec.size,
              mediaAssetId: rec.mediaAssetId,
              allowMediaMatch: true,
              requestPermission: false,
            });
            existsLocally = target.exists;
            if (target.exists && target.resolvedUri) {
              resolvedLocalUri = target.resolvedUri;
            }
          } catch {
            existsLocally = false;
          }
          return {
            ...rec,
            destinationTitle,
            category,
            existsLocally,
            ...(resolvedLocalUri !== rec.uri && resolvedLocalUri.startsWith('file://')
              ? { cachedLocalUri: resolvedLocalUri }
              : {}),
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

  const itemsInScope = useMemo(() => {
    if (!config?.multiChannelRouting || streamScope === 'all') {
      return items;
    }
    // 'current': files that exist locally or originated as local backup file
    return items.filter(
      (it) => it.existsLocally || !it.uri.startsWith('tg://') || (it as any).sourceType !== 'remote_cloud'
    );
  }, [items, streamScope, config]);

  const totalScopeBytes = useMemo(() => {
    return itemsInScope.reduce((acc, it) => acc + (it.size || 0), 0);
  }, [itemsInScope]);

  const totalCloudBytes = useMemo(() => {
    return items.reduce((acc, it) => acc + (it.size || 0), 0);
  }, [items]);

  const categoryCounts = useMemo(() => {
    const counts = { all: itemsInScope.length, image: 0, video: 0, audio: 0, document: 0, missing: 0 };
    for (const it of itemsInScope) {
      if (it.category in counts) {
        counts[it.category as keyof typeof counts] += 1;
      }
      if (it.cloudStatus === 'missing') {
        counts.missing += 1;
      }
    }
    return counts;
  }, [itemsInScope]);

  const filteredAndSortedItems = useMemo(() => {
    let result = itemsInScope;

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
  }, [itemsInScope, searchQuery, activeCategory, sortOption]);

  const filteredBytes = useMemo(() => {
    return filteredAndSortedItems.reduce((acc, it) => acc + (it.size || 0), 0);
  }, [filteredAndSortedItems]);

  const resolvedItemDest = useMemo(() => {
    if (!selectedItem) {
      return {
        title: '',
        icon: 'cloud' as any,
        isStream: false,
        streamCategory: 'Cloud Storage',
      };
    }
    let title = selectedItem.destinationTitle || '';
    let icon: any = 'cloud';
    let streamCategory = 'Cloud Storage';

    if (config?.multiChannelRouting) {
      if (selectedItem.category === 'image') {
        icon = 'photo';
        streamCategory = 'Photos Stream';
        if (!title) title = config.photoChannelTitle || 'Photos Channel';
      } else if (selectedItem.category === 'video') {
        icon = 'video-camera';
        streamCategory = 'Videos Stream';
        if (!title) title = config.videoChannelTitle || 'Videos Channel';
      } else {
        icon = 'file-text';
        streamCategory = 'Documents Stream';
        if (!title) title = config.documentChannelTitle || 'Documents Channel';
      }
    } else {
      if (!title) {
        title =
          config?.uploadToSavedMessages || !config?.targetChatId
            ? 'Saved Messages'
            : config?.targetChatTitle || 'Target Channel';
      }
    }

    return {
      title,
      icon,
      isStream: !!config?.multiChannelRouting,
      streamCategory,
    };
  }, [selectedItem, config]);

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

  const cacheResolvedUri = useCallback((recordUri: string, localFileUri: string) => {
    setItems((prev) =>
      prev.map((it) =>
        it.uri === recordUri
          ? { ...it, cachedLocalUri: localFileUri, existsLocally: true }
          : it
      )
    );
    setSelectedItem((prev) =>
      prev && prev.uri === recordUri
        ? { ...prev, cachedLocalUri: localFileUri, existsLocally: true }
        : prev
    );
    setMediaPlayerItem((prev) =>
      prev && prev.uri === recordUri
        ? { ...prev, cachedLocalUri: localFileUri, existsLocally: true }
        : prev
    );
  }, []);

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
              const hasMediaItems = selectedItemsList.some(
                (it) => it.category === 'image' || it.category === 'video'
              );
              let mediaPermGranted = false;
              if (hasMediaItems) {
                const perm = await MediaLibrary.requestPermissionsAsync(true).catch(() => ({
                  status: MediaLibrary.PermissionStatus.DENIED,
                }));
                mediaPermGranted = perm.status === MediaLibrary.PermissionStatus.GRANTED;
              }

              for (let i = 0; i < selectedItemsList.length; i++) {
                const it = selectedItemsList[i];
                setBulkStatusText(`Preparing ${i + 1} of ${selectedItemsList.length}: ${it.fileName}...`);
                const localUri = await downloadCloudItemToLocal(it);
                if (mediaPermGranted && (it.category === 'image' || it.category === 'video')) {
                  await MediaLibrary.saveToLibraryAsync(localUri).catch(() => {});
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
      const canShare = await Sharing.isAvailableAsync();
      if (!canShare) {
        Alert.alert('Sharing Unavailable', 'File sharing is not supported on this device.');
        return;
      }

      if (selectedItemsList.length === 1) {
        await handleShareFile(selectedItemsList[0]);
        exitSelectMode();
        return;
      }

      for (let i = 0; i < selectedItemsList.length; i++) {
        const it = selectedItemsList[i];
        setBulkStatusText(`Preparing ${i + 1} of ${selectedItemsList.length}: ${it.fileName}...`);
        let fileUri = await downloadCloudItemToLocal(it);
        if (!fileUri.startsWith('file://')) {
          fileUri = await ensureFileSchemeUri(fileUri, it.fileName);
        }
        if (!fileUri.startsWith('file://')) {
          fileUri = `file://${fileUri}`;
        }
        await Sharing.shareAsync(fileUri, {
          mimeType: getMimeTypeFromFileName(it.fileName),
          dialogTitle: `Share ${it.fileName}`,
        });
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

  const downloadCloudItemToLocal = useCallback(async (item: CloudItem): Promise<string> => {
    // Reuse verified cached file:// copy if available
    if (item.cachedLocalUri && item.cachedLocalUri.startsWith('file://')) {
      const cachedInfo = await FileSystem.getInfoAsync(item.cachedLocalUri).catch(() => ({ exists: false }));
      if (cachedInfo.exists) return item.cachedLocalUri;
    }

    // If stored locally on device (including Android content:// URIs), normalize to a file:// URI
    if (item.existsLocally && !item.uri.startsWith('tg://')) {
      try {
        const target = await resolveLocalFileTarget({
          uri: item.uri,
          fileName: item.fileName,
          size: item.size,
          mediaAssetId: item.mediaAssetId,
          allowMediaMatch: true,
          requestPermission: false,
        });
        if (target?.exists && target.resolvedUri) {
          const fileUri = await ensureFileSchemeUri(target.resolvedUri, item.fileName);
          const safeFileUri = fileUri.startsWith('file://') ? fileUri : `file://${fileUri}`;
          cacheResolvedUri(item.uri, safeFileUri);
          return safeFileUri;
        }
      } catch {
        // Fall back to Telegram cloud download if local resolution fails
      }
    }

    const chatId =
      item.chatId || (await tdLibClient.resolveTargetChatId(config?.targetChatId || 'me'));

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
        downloadedPartUris.push(partLocalPath.startsWith('file://') ? partLocalPath : `file://${partLocalPath}`);
      }

      setDownloadStatusText('Reassembling multi-part file...');
      const reassembledDest = getRestoredCachePath(item.fileName, item.uploadedAt || item.telegramMessageId || 1);
      await reassembleChunks(downloadedPartUris, reassembledDest, (pct) => {
        setDownloadProgress(pct / 100);
      });
      const safeReassembled = reassembledDest.startsWith('file://') ? reassembledDest : `file://${reassembledDest}`;
      cacheResolvedUri(item.uri, safeReassembled);
      return safeReassembled;
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

    const rawFileUri = localPath.startsWith('file://') ? localPath : `file://${localPath}`;

    // Transparently decrypt zero-knowledge vault files
    const isEncrypted = await vaultService.isEncryptedFile(rawFileUri).catch(() => false);
    if (isEncrypted) {
      setDownloadStatusText('Decrypting zero-knowledge vault file...');
      const decryptedPath = getRestoredCachePath(`dec_${item.fileName}`, item.uploadedAt || 1);
      await vaultService.decryptFile(rawFileUri, decryptedPath);
      const safeDecrypted = decryptedPath.startsWith('file://') ? decryptedPath : `file://${decryptedPath}`;
      cacheResolvedUri(item.uri, safeDecrypted);
      return safeDecrypted;
    }

    const ensuredUri = await ensureFileSchemeUri(rawFileUri, item.fileName);
    const safeEnsuredUri = ensuredUri.startsWith('file://') ? ensuredUri : `file://${ensuredUri}`;
    cacheResolvedUri(item.uri, safeEnsuredUri);
    return safeEnsuredUri;
  }, [config?.targetChatId, cacheResolvedUri]);

  const handleDownloadToDevice = async (item: CloudItem) => {
    if (downloadingItemUri) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setDownloadingItemUri(item.uri);
    setDownloadProgress(0);
    setDownloadStatusText('Preparing file...');

    try {
      let localUri = await downloadCloudItemToLocal(item);
      if (!localUri.startsWith('file://')) {
        localUri = await ensureFileSchemeUri(localUri, item.fileName);
      }
      if (!localUri.startsWith('file://')) {
        localUri = `file://${localUri}`;
      }

      // Save directly into MediaLibrary gallery if image or video
      if (item.category === 'image' || item.category === 'video') {
        const { status } = await MediaLibrary.requestPermissionsAsync(true);
        if (status === MediaLibrary.PermissionStatus.GRANTED) {
          await MediaLibrary.saveToLibraryAsync(localUri);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          Alert.alert(
            'Saved to Gallery',
            `"${item.fileName}" has been saved to your device Photos & Gallery.`
          );
        } else {
          await Sharing.shareAsync(localUri, {
            mimeType: getMimeTypeFromFileName(item.fileName),
            dialogTitle: `Save ${item.fileName}`,
          });
        }
      } else {
        await Sharing.shareAsync(localUri, {
          mimeType: getMimeTypeFromFileName(item.fileName),
          dialogTitle: `Save ${item.fileName}`,
        });
      }
    } catch (err: any) {
      Alert.alert('Save Failed', err?.message || 'Could not save file to device.');
    } finally {
      setDownloadingItemUri(null);
      setDownloadProgress(0);
      setDownloadStatusText('');
    }
  };

  const handleShareFile = async (item: CloudItem) => {
    if (isSharing || downloadingItemUri) return;
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

      let shareUri = await downloadCloudItemToLocal(item);
      if (!shareUri.startsWith('file://')) {
        shareUri = await ensureFileSchemeUri(shareUri, item.fileName);
      }
      if (!shareUri.startsWith('file://')) {
        shareUri = `file://${shareUri}`;
      }

      await Sharing.shareAsync(shareUri, {
        mimeType: getMimeTypeFromFileName(item.fileName),
        dialogTitle: `Share ${item.fileName}`,
      });
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

  const handleLoadPreviewForModal = useCallback(async (previewItem: MediaPreviewItem): Promise<string | null> => {
    const matched = items.find((it) => it.uri === previewItem.uri) || (previewItem as CloudItem);
    return await downloadCloudItemToLocal(matched);
  }, [items, downloadCloudItemToLocal]);

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
            {item.destinationTitle ? (
              <>
                <Text style={[styles.listDot, { color: subtextColor }]}>•</Text>
                <View style={[styles.destBadge, { backgroundColor: isDark ? '#1E293B' : '#EEF2FF', borderColor: border }]}>
                  <Text style={[styles.destBadgeText, { color: '#2563EB' }]} numberOfLines={1}>
                    {item.destinationTitle}
                  </Text>
                </View>
              </>
            ) : null}
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

      {/* Total Stream / Cloud Backup Hero Card */}
      <View
        style={[
          styles.heroSummaryCard,
          {
            backgroundColor: isDark ? '#1E293B' : '#0F172A',
            borderColor: isDark ? '#334155' : '#1E293B',
          },
        ]}
      >
        <View style={styles.heroSummaryTopRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.heroSummarySubhead}>
              {config?.multiChannelRouting ? 'TOTAL STREAM BACKUP' : 'TOTAL CLOUD BACKUP'}
            </Text>
            <Text style={styles.heroSummaryHeadline}>
              {formatFileSize(activeCategory === 'all' && !searchQuery ? totalScopeBytes : filteredBytes)}
            </Text>
          </View>
          <View style={styles.heroSummaryBadge}>
            <FontAwesome name="cloud" size={12} color="#208AEF" />
            <Text style={styles.heroSummaryBadgeText}>
              {filteredAndSortedItems.length} {filteredAndSortedItems.length === 1 ? 'file' : 'files'}
            </Text>
          </View>
        </View>

        {config?.multiChannelRouting && (
          <>
            <View style={[styles.heroSummaryDivider, { backgroundColor: isDark ? '#334155' : '#1E293B' }]} />
            <View style={styles.heroSummaryBottomRow}>
              {/* Scope Switcher: Current Backup vs All Stream Cloud */}
              <View style={[styles.scopeSwitcherContainer, { backgroundColor: isDark ? '#0F172A' : '#1E293B' }]}>
                <TouchableOpacity
                  style={[
                    styles.scopeSwitchBtn,
                    streamScope === 'current' && styles.scopeSwitchBtnActive,
                  ]}
                  onPress={() => {
                    Haptics.selectionAsync().catch(() => {});
                    setStreamScope('current');
                  }}
                  activeOpacity={0.8}
                >
                  <FontAwesome
                    name="mobile"
                    size={13}
                    color={streamScope === 'current' ? '#FFFFFF' : '#94A3B8'}
                    style={{ marginRight: 5 }}
                  />
                  <Text
                    style={[
                      styles.scopeSwitchBtnText,
                      streamScope === 'current' && styles.scopeSwitchBtnTextActive,
                    ]}
                  >
                    Current Backup
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.scopeSwitchBtn,
                    streamScope === 'all' && styles.scopeSwitchBtnActive,
                  ]}
                  onPress={() => {
                    Haptics.selectionAsync().catch(() => {});
                    setStreamScope('all');
                  }}
                  activeOpacity={0.8}
                >
                  <FontAwesome
                    name="cloud"
                    size={11}
                    color={streamScope === 'all' ? '#FFFFFF' : '#94A3B8'}
                    style={{ marginRight: 5 }}
                  />
                  <Text
                    style={[
                      styles.scopeSwitchBtnText,
                      streamScope === 'all' && styles.scopeSwitchBtnTextActive,
                    ]}
                  >
                    All Stream Cloud
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Sync Streams Quick Action */}
              <TouchableOpacity
                style={styles.heroSyncBtn}
                onPress={handleImportFromTelegram}
                disabled={isImporting}
                activeOpacity={0.8}
              >
                {isImporting ? (
                  <ActivityIndicator size="small" color="#FFFFFF" style={{ marginRight: 5 }} />
                ) : (
                  <FontAwesome name="refresh" size={11} color="#FFFFFF" style={{ marginRight: 5 }} />
                )}
                <Text style={styles.heroSyncBtnText}>
                  {isImporting ? 'Syncing...' : 'Sync Streams'}
                </Text>
              </TouchableOpacity>
            </View>
          </>
        )}
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

      {/* Multi-Stream Channels Quick-Selector Bar */}
      {config?.multiChannelRouting && (
        <View
          style={[
            styles.multiStreamHeaderBar,
            {
              backgroundColor: isDark ? '#1E293B' : '#EFF6FF',
              borderColor: isDark ? '#334155' : '#DBEAFE',
            },
          ]}
        >
          <View style={styles.multiStreamTopRow}>
            <View style={styles.multiStreamBadge}>
              <FontAwesome name="random" size={11} color="#2563EB" />
              <Text style={styles.multiStreamBadgeText}>MULTI-STREAM ACTIVE</Text>
            </View>
            <Text style={[styles.multiStreamNote, { color: subtextColor }]}>
              3 Channels • Saved Messages hidden
            </Text>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.multiStreamChipsScroll}
          >
            <TouchableOpacity
              style={[
                styles.streamChip,
                activeCategory === 'image' && styles.streamChipActive,
                {
                  backgroundColor:
                    activeCategory === 'image' ? '#10B981' : isDark ? '#0F172A' : '#FFFFFF',
                  borderColor: activeCategory === 'image' ? '#10B981' : border,
                },
              ]}
              onPress={() => {
                Haptics.selectionAsync().catch(() => {});
                setActiveCategory(activeCategory === 'image' ? 'all' : 'image');
              }}
            >
              <FontAwesome
                name="photo"
                size={11}
                color={activeCategory === 'image' ? '#FFFFFF' : '#10B981'}
              />
              <Text
                style={[
                  styles.streamChipText,
                  { color: activeCategory === 'image' ? '#FFFFFF' : textColor },
                ]}
                numberOfLines={1}
              >
                Photos: {config.photoChannelTitle || 'Configured'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.streamChip,
                activeCategory === 'video' && styles.streamChipActive,
                {
                  backgroundColor:
                    activeCategory === 'video' ? '#8B5CF6' : isDark ? '#0F172A' : '#FFFFFF',
                  borderColor: activeCategory === 'video' ? '#8B5CF6' : border,
                },
              ]}
              onPress={() => {
                Haptics.selectionAsync().catch(() => {});
                setActiveCategory(activeCategory === 'video' ? 'all' : 'video');
              }}
            >
              <FontAwesome
                name="video-camera"
                size={11}
                color={activeCategory === 'video' ? '#FFFFFF' : '#8B5CF6'}
              />
              <Text
                style={[
                  styles.streamChipText,
                  { color: activeCategory === 'video' ? '#FFFFFF' : textColor },
                ]}
                numberOfLines={1}
              >
                Videos: {config.videoChannelTitle || 'Configured'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.streamChip,
                activeCategory === 'document' && styles.streamChipActive,
                {
                  backgroundColor:
                    activeCategory === 'document' ? '#3B82F6' : isDark ? '#0F172A' : '#FFFFFF',
                  borderColor: activeCategory === 'document' ? '#3B82F6' : border,
                },
              ]}
              onPress={() => {
                Haptics.selectionAsync().catch(() => {});
                setActiveCategory(activeCategory === 'document' ? 'all' : 'document');
              }}
            >
              <FontAwesome
                name="file-text"
                size={11}
                color={activeCategory === 'document' ? '#FFFFFF' : '#3B82F6'}
              />
              <Text
                style={[
                  styles.streamChipText,
                  { color: activeCategory === 'document' ? '#FFFFFF' : textColor },
                ]}
                numberOfLines={1}
              >
                Docs: {config.documentChannelTitle || 'Configured'}
              </Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      )}

      {/* Category Filter Chips Horizontal ScrollView */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.categoryChipsScroll}
      >
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
      </ScrollView>

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
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: Math.max(insets.bottom, 20) + (isSelectMode ? 96 : 16) },
          ]}
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
            <TouchableOpacity
              style={StyleSheet.absoluteFill}
              activeOpacity={1}
              onPress={() => setSelectedItem(null)}
            />
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
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <FontAwesome name="times" size={16} color={subtextColor} />
                </TouchableOpacity>
              </View>

              <ScrollView
                showsVerticalScrollIndicator={false}
                bounces={false}
                style={styles.modalScrollBody}
              >
                {/* Preview Box — tap to open full-screen View */}
                <TouchableOpacity
                  activeOpacity={0.85}
                  onPress={() => {
                    const it = selectedItem;
                    setSelectedItem(null);
                    setMediaPlayerItem(it);
                  }}
                >
                  {selectedItem.category === 'image' &&
                  (selectedItem.cachedLocalUri ||
                    (selectedItem.existsLocally && !selectedItem.uri.startsWith('tg://'))) ? (
                    <View style={styles.lightboxImageWrap}>
                      <Image
                        source={{ uri: selectedItem.cachedLocalUri || selectedItem.uri }}
                        style={styles.lightboxImage}
                        resizeMode="contain"
                      />
                    </View>
                  ) : (
                    <View
                      style={[
                        styles.lightboxPlaceholder,
                        { backgroundColor: isDark ? '#0F172A' : '#F1F5F9' },
                      ]}
                    >
                      <FontAwesome
                        name={getCategoryIcon(selectedItem.category) as any}
                        size={44}
                        color="#208AEF"
                      />
                      <Text style={[styles.lightboxPlaceholderText, { color: subtextColor }]}>
                        {selectedItem.existsLocally
                          ? 'Ready on Device • Tap to View'
                          : 'Preserved in Telegram Cloud • Tap to View'}
                      </Text>
                    </View>
                  )}
                </TouchableOpacity>

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

                {/* Prominent Stream Destination Card */}
                <View
                  style={[
                    styles.destinationCard,
                    {
                      backgroundColor: isDark ? '#1E293B' : '#EFF6FF',
                      borderColor: isDark ? '#3B82F6' : '#BFDBFE',
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.destinationIconCircle,
                      {
                        backgroundColor:
                          selectedItem.category === 'image'
                            ? '#10B981'
                            : selectedItem.category === 'video'
                            ? '#8B5CF6'
                            : '#2563EB',
                      },
                    ]}
                  >
                    <FontAwesome name={resolvedItemDest.icon} size={15} color="#FFFFFF" />
                  </View>
                  <View style={styles.destinationTextCol}>
                    <View style={styles.destinationBadgeRow}>
                      <Text
                        style={[
                          styles.destinationBadgeText,
                          {
                            color:
                              selectedItem.category === 'image'
                                ? '#10B981'
                                : selectedItem.category === 'video'
                                ? '#8B5CF6'
                                : '#2563EB',
                          },
                        ]}
                      >
                        {config?.multiChannelRouting
                          ? `${resolvedItemDest.streamCategory.toUpperCase()} CHANNEL`
                          : 'DESTINATION CHANNEL'}
                      </Text>
                    </View>
                    <Text
                      style={[styles.destinationTitleText, { color: textColor }]}
                      numberOfLines={1}
                    >
                      {resolvedItemDest.title}
                    </Text>
                    {selectedItem.chatId && (
                      <Text style={[styles.destinationChatIdText, { color: subtextColor }]}>
                        Channel ID: {selectedItem.chatId}
                      </Text>
                    )}
                  </View>
                </View>

                {/* Metadata Card */}
                <View
                  style={[
                    styles.metadataCard,
                    { backgroundColor: isDark ? '#0F172A' : '#F8FAFC', borderColor: border },
                  ]}
                >
                  <View style={styles.metaRowBetween}>
                    <Text style={[styles.metaLabel, { color: subtextColor }]}>
                      {config?.multiChannelRouting ? 'Stream Channel' : 'Telegram Destination'}
                    </Text>
                    <Text style={[styles.metaVal, { color: '#2563EB', fontWeight: '700' }]} numberOfLines={1}>
                      {resolvedItemDest.title}
                    </Text>
                  </View>
                  <View style={[styles.metaDivider, { backgroundColor: border }]} />
                  <View style={styles.metaRowBetween}>
                    <Text style={[styles.metaLabel, { color: subtextColor }]}>Cloud Message ID</Text>
                    <Text style={[styles.metaVal, { color: '#208AEF' }]} numberOfLines={1}>
                      #{selectedItem.telegramMessageId || 'Confirmed'}
                    </Text>
                  </View>
                  <View style={[styles.metaDivider, { backgroundColor: border }]} />
                  <View style={styles.metaRowBetween}>
                    <Text style={[styles.metaLabel, { color: subtextColor }]}>Uploaded Date</Text>
                    <Text style={[styles.metaVal, { color: textColor }]} numberOfLines={1}>
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
                        {selectedItem.existsLocally ? 'Stored on Phone' : 'Cloud-only'}
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
                  <View style={[styles.metaDivider, { backgroundColor: border }]} />
                  <View style={styles.metaColBlock}>
                    <Text style={[styles.metaLabel, { color: subtextColor, marginBottom: 4 }]}>
                      File Location / Cloud URI
                    </Text>
                    <View style={[styles.uriBox, { backgroundColor: isDark ? '#1E293B' : '#F1F5F9', borderColor: border }]}>
                      <Text style={[styles.uriText, { color: textColor }]} selectable numberOfLines={3}>
                        {selectedItem.uri}
                      </Text>
                    </View>
                  </View>
                </View>
              </ScrollView>

              {/* Spacious 2-Row Action Footer */}
              {selectedItem.cloudStatus === 'missing' ? (
                <View style={styles.modalActionContainer}>
                  <View style={styles.modalActionRow}>
                    {selectedItem.existsLocally ? (
                      <TouchableOpacity
                        style={[styles.primaryActionBtn, { backgroundColor: '#208AEF' }]}
                        onPress={() => handleReuploadMissing(selectedItem)}
                      >
                        <FontAwesome name="cloud-upload" size={14} color="#FFFFFF" style={{ marginRight: 8 }} />
                        <Text style={styles.primaryActionBtnText} numberOfLines={1}>
                          Re-upload to Cloud
                        </Text>
                      </TouchableOpacity>
                    ) : (
                      <TouchableOpacity
                        style={[styles.primaryActionBtn, { backgroundColor: '#64748B' }]}
                        onPress={() => handleRemoveStaleRecord(selectedItem)}
                      >
                        <FontAwesome name="trash" size={14} color="#FFFFFF" style={{ marginRight: 8 }} />
                        <Text style={styles.primaryActionBtnText} numberOfLines={1}>
                          Remove from List
                        </Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity
                      style={[styles.secondaryActionBtn, { borderColor: border }]}
                      onPress={() => setSelectedItem(null)}
                    >
                      <Text style={[styles.secondaryActionBtnText, { color: textColor }]} numberOfLines={1}>
                        Close
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <View style={styles.modalActionContainer}>
                  <View style={styles.modalActionRow}>
                    <TouchableOpacity
                      style={[
                        styles.primaryActionBtn,
                        { backgroundColor: '#10B981', opacity: downloadingItemUri !== null ? 0.6 : 1 },
                      ]}
                      onPress={() => handleDownloadToDevice(selectedItem)}
                      disabled={downloadingItemUri !== null}
                    >
                      {downloadingItemUri === selectedItem.uri && !isSharing ? (
                        <ActivityIndicator size="small" color="#FFFFFF" style={{ marginRight: 6 }} />
                      ) : (
                        <FontAwesome
                          name={
                            selectedItem.category === 'image' || selectedItem.category === 'video'
                              ? 'photo'
                              : selectedItem.existsLocally
                              ? 'folder-open'
                              : 'download'
                          }
                          size={14}
                          color="#FFFFFF"
                          style={{ marginRight: 7 }}
                        />
                      )}
                      <Text style={styles.primaryActionBtnText} numberOfLines={1}>
                        {downloadingItemUri === selectedItem.uri && !isSharing
                          ? `${Math.round(downloadProgress * 100)}%`
                          : selectedItem.category === 'image' || selectedItem.category === 'video'
                          ? 'Save to Gallery'
                          : selectedItem.existsLocally
                          ? 'Save File'
                          : 'Download'}
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[
                        styles.primaryActionBtn,
                        { backgroundColor: '#208AEF', opacity: isSharing || downloadingItemUri !== null ? 0.6 : 1 },
                      ]}
                      onPress={() => handleShareFile(selectedItem)}
                      disabled={isSharing || downloadingItemUri !== null}
                    >
                      {isSharing && downloadingItemUri === selectedItem.uri ? (
                        <ActivityIndicator size="small" color="#FFFFFF" style={{ marginRight: 6 }} />
                      ) : (
                        <FontAwesome name="share" size={14} color="#FFFFFF" style={{ marginRight: 7 }} />
                      )}
                      <Text style={styles.primaryActionBtnText} numberOfLines={1}>
                        Share
                      </Text>
                    </TouchableOpacity>
                  </View>

                  <View style={styles.modalActionRow}>
                    <TouchableOpacity
                      style={[styles.primaryActionBtn, { backgroundColor: '#6366F1' }]}
                      onPress={() => {
                        const it = selectedItem;
                        setSelectedItem(null);
                        setMediaPlayerItem(it);
                      }}
                    >
                      <FontAwesome
                        name={
                          selectedItem.category === 'video' || selectedItem.category === 'audio'
                            ? 'play'
                            : 'eye'
                        }
                        size={14}
                        color="#FFFFFF"
                        style={{ marginRight: 7 }}
                      />
                      <Text style={styles.primaryActionBtnText} numberOfLines={1}>
                        View
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.dangerGridBtn, { opacity: isDeletingCloud ? 0.6 : 1 }]}
                      onPress={() => handleDeleteFromCloud(selectedItem)}
                      disabled={isDeletingCloud}
                    >
                      {isDeletingCloud ? (
                        <ActivityIndicator size="small" color="#EF4444" />
                      ) : (
                        <>
                          <FontAwesome name="trash-o" size={14} color="#EF4444" style={{ marginRight: 7 }} />
                          <Text style={styles.dangerGridBtnText} numberOfLines={1}>
                            Delete
                          </Text>
                        </>
                      )}
                    </TouchableOpacity>
                  </View>

                  <TouchableOpacity
                    style={[styles.secondaryActionBtn, { borderColor: border, marginTop: 4 }]}
                    onPress={() => setSelectedItem(null)}
                  >
                    <Text style={[styles.secondaryActionBtnText, { color: textColor }]} numberOfLines={1}>
                      Close
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
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
        onLoadPreview={handleLoadPreviewForModal}
        onOpenExternal={(item) => handleShareFile(item as CloudItem)}
        isDownloading={downloadingItemUri !== null}
        downloadProgress={downloadProgress}
        downloadStatusText={downloadStatusText}
      />

      {/* Floating Bulk Action Bar */}
      {isSelectMode && selectedUris.size > 0 && (
        <View
          style={[
            styles.bulkActionBar,
            {
              backgroundColor: cardBg,
              borderColor: border,
              bottom: Math.max(insets.bottom, Platform.OS === 'android' ? 28 : 16) + 12,
            },
          ]}
        >
          <TouchableOpacity
            style={styles.bulkActionBtn}
            onPress={handleBulkDownload}
            disabled={isBulkOperating}
          >
            <FontAwesome name="download" size={16} color="#208AEF" />
            <Text style={[styles.bulkActionText, { color: '#208AEF' }]} numberOfLines={1}>
              Download ({selectedUris.size})
            </Text>
          </TouchableOpacity>

          <View style={[styles.bulkDivider, { backgroundColor: border }]} />

          <TouchableOpacity
            style={styles.bulkActionBtn}
            onPress={handleBulkShare}
            disabled={isBulkOperating}
          >
            <FontAwesome name="share" size={16} color="#208AEF" />
            <Text style={[styles.bulkActionText, { color: '#208AEF' }]} numberOfLines={1}>
              Share
            </Text>
          </TouchableOpacity>

          <View style={[styles.bulkDivider, { backgroundColor: border }]} />

          <TouchableOpacity
            style={styles.bulkActionBtn}
            onPress={handleBulkDelete}
            disabled={isBulkOperating}
          >
            <FontAwesome name="trash" size={16} color="#EF4444" />
            <Text style={[styles.bulkActionText, { color: '#EF4444' }]} numberOfLines={1}>
              Delete
            </Text>
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
  categoryChipsScroll: {
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
    maxHeight: '88%',
  },
  modalScrollBody: {
    flexShrink: 1,
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
    width: 32,
    height: 32,
    borderRadius: 16,
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
    height: 150,
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
    marginBottom: 14,
  },
  metaRowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 5,
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
    flex: 1,
    textAlign: 'right',
    marginLeft: 12,
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
  modalActionContainer: {
    gap: 10,
    paddingTop: 4,
  },
  modalActionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  primaryActionBtn: {
    flex: 1,
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#208AEF',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 12,
  },
  primaryActionBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  secondaryActionBtn: {
    minHeight: 46,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryActionBtnText: {
    fontSize: 13,
    fontWeight: '600',
  },
  dangerGridBtn: {
    flex: 1,
    minHeight: 46,
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.45)',
    backgroundColor: 'rgba(239, 68, 68, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dangerGridBtnText: {
    color: '#EF4444',
    fontSize: 13,
    fontWeight: '700',
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
  multiStreamHeaderBar: {
    marginHorizontal: 16,
    marginBottom: 10,
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  multiStreamTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  multiStreamBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  multiStreamBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#2563EB',
    letterSpacing: 0.5,
  },
  multiStreamNote: {
    fontSize: 11,
  },
  multiStreamChipsScroll: {
    flexDirection: 'row',
    gap: 8,
  },
  streamChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  streamChipActive: {
    borderColor: 'transparent',
  },
  streamChipText: {
    fontSize: 11,
    fontWeight: '600',
    maxWidth: 140,
  },
  destinationCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 12,
    marginBottom: 14,
    gap: 12,
  },
  destinationIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  destinationTextCol: {
    flex: 1,
  },
  destinationBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
  },
  destinationBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  destinationTitleText: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 2,
  },
  destinationChatIdText: {
    fontSize: 11,
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
  heroSummaryCard: {
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  heroSummaryTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  heroSummarySubhead: {
    fontSize: 11,
    fontWeight: '700',
    color: '#94A3B8',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  heroSummaryHeadline: {
    fontSize: 26,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: -0.5,
  },
  heroSummaryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: 'rgba(32, 138, 239, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(32, 138, 239, 0.3)',
  },
  heroSummaryBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#208AEF',
  },
  heroSummaryDivider: {
    height: 1,
    marginVertical: 12,
    opacity: 0.5,
  },
  heroSummaryBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  scopeSwitcherContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 3,
    borderRadius: 12,
    flex: 1,
  },
  scopeSwitchBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 9,
  },
  scopeSwitchBtnActive: {
    backgroundColor: '#208AEF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 2,
  },
  scopeSwitchBtnText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#94A3B8',
  },
  scopeSwitchBtnTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  heroSyncBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#10B981',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 10,
  },
  heroSyncBtnText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  destBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    maxWidth: 120,
  },
  destBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  metaColBlock: {
    paddingVertical: 4,
  },
  uriBox: {
    padding: 8,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 2,
  },
  uriText: {
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
});
