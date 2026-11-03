import { Stack, router } from 'expo-router';
import { DestinationSelector } from '@/components/DestinationSelector';
import { FileDetailData, FileDetailsModal } from '@/components/FileDetailsModal';
import { FolderBrowserModal } from '@/components/FolderBrowserModal';
import {
  getFileCategory,
  pickSingleFile,
  requestMediaPermissions,
  scanForNewFiles,
  ScannedFile,
} from '@/lib/scanner/files';
import {
  ActionHistoryItem,
  addToQueue,
  clearActionHistory,
  formatDuration,
  formatFileSize,
  formatSpeed,
  getActionHistory,
  getQueue,
  getWatchedFolders,
  QueueItem,
  removeFromQueue,
  clearAllQueue,
  WatchedFolder,
} from '@/lib/storage/queue';
import { uploadManager } from '@/lib/upload/manager';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useColorScheme,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

type HistoryFilter = 'all' | 'uploaded' | 'failed' | 'dismissed';
type QueueCategoryFilter = 'all' | 'image' | 'video' | 'audio' | 'document';

const PAGE_SIZE = 20;

export default function UploadScreen() {
  const [activeTab, setActiveTab] = useState<'queue' | 'history'>('queue');
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [history, setHistory] = useState<ActionHistoryItem[]>([]);
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>('all');
  const [queueFilter, setQueueFilter] = useState<QueueCategoryFilter>('all');
  const [queueShowAll, setQueueShowAll] = useState(false);
  const [historyShowAll, setHistoryShowAll] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanStatusText, setScanStatusText] = useState('');
  const [uploading, setUploading] = useState(false);
  const [folderModalVisible, setFolderModalVisible] = useState(false);
  const [watchedFolders, setWatchedFolders] = useState<WatchedFolder[]>([]);
  const [selectedFileForDetails, setSelectedFileForDetails] = useState<FileDetailData | null>(null);
  const scanAbortRef = useRef<AbortController | null>(null);

  const loadData = async () => {
    const [q, h, wf] = await Promise.all([getQueue(), getActionHistory(), getWatchedFolders()]);
    setQueue(q);
    setHistory(h);
    setWatchedFolders(wf);
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 2000);
    return () => clearInterval(interval);
  }, []);

  const handlePickSingleFile = async () => {
    try {
      const file = await pickSingleFile();
      if (!file) return;

      const added = await addToQueue({
        uri: file.uri,
        fileName: file.fileName,
        size: file.size,
        mimeType: file.mimeType,
      });
      loadData();

      setSelectedFileForDetails({
        ...added,
        isHistory: false,
      });
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to pick file');
    }
  };

  const handleFolderFilesSelected = async (files: ScannedFile[], uploadNow: boolean) => {
    try {
      let totalBytes = 0;
      for (const file of files) {
        totalBytes += file.size || 0;
        await addToQueue({
          uri: file.uri,
          fileName: file.fileName,
          size: file.size,
          mimeType: file.mimeType,
        });
      }
      loadData();

      if (uploadNow) {
        startUpload();
      } else {
        Alert.alert(
          'Success',
          `Added ${files.length} files (${formatFileSize(totalBytes)}) to queue`
        );
      }
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to add files to queue');
    }
  };

  const scanAndQueueAll = async (foldersToUse?: WatchedFolder[]) => {
    const foldersToScan = foldersToUse || watchedFolders;
    if (foldersToScan.length === 0) {
      Alert.alert(
        'No Folders Selected',
        'Please select which folders to scan.',
        [
          { text: 'Choose Folders', onPress: () => setFolderModalVisible(true) },
          { text: 'Cancel', style: 'cancel' },
        ]
      );
      return;
    }

    setScanning(true);
    setScanStatusText('Preparing scan...');
    const controller = new AbortController();
    scanAbortRef.current = controller;

    try {
      const hasPermission = await requestMediaPermissions();
      if (!hasPermission) {
        Alert.alert(
          'Permission Required',
          'Media library permission is required to scan files. Please grant media permission when prompted or in system settings.'
        );
        return;
      }

      const newFiles = await scanForNewFiles({
        folders: foldersToScan,
        abortSignal: controller.signal,
        onProgress: (count, currentFolder) => {
          setScanStatusText(`Scanning ${currentFolder}... (${count} found)`);
        },
      });

      if (controller.signal.aborted) {
        Alert.alert('Scan Cancelled', 'Media scan was stopped by user.');
        return;
      }

      if (newFiles.length === 0) {
        Alert.alert(
          'Scan Complete',
          `No new files found in ${foldersToScan.length} selected folder(s).`
        );
        return;
      }

      let totalBytes = 0;
      for (const file of newFiles) {
        if (controller.signal.aborted) break;
        totalBytes += file.size || 0;
        await addToQueue({
          uri: file.uri,
          fileName: file.fileName,
          size: file.size,
          mimeType: file.mimeType,
        });
      }

      if (controller.signal.aborted) {
        Alert.alert('Scan Cancelled', 'Adding files to queue was stopped.');
        return;
      }

      Alert.alert(
        'Success',
        `Added ${newFiles.length} files (${formatFileSize(totalBytes)}) from ${foldersToScan.length} folder(s) to queue`
      );
      loadData();
    } catch (error: any) {
      if (controller.signal.aborted) {
        Alert.alert('Scan Cancelled', 'Media scan stopped.');
      } else {
        Alert.alert('Error', error.message || 'Scan error occurred');
      }
    } finally {
      setScanning(false);
      setScanStatusText('');
      scanAbortRef.current = null;
    }
  };

  const abortScan = () => {
    if (scanAbortRef.current) {
      scanAbortRef.current.abort();
    }
    setScanning(false);
    setScanStatusText('Aborting scan...');
  };

  const startUpload = async () => {
    setUploading(true);
    try {
      const result = await uploadManager.processQueue({ forceManual: true });
      loadData();
      if (result.failed === 0) {
        Alert.alert('Success', `Successfully uploaded ${result.uploaded} file(s)!`);
      } else if (result.uploaded > 0) {
        Alert.alert(
          'Upload Completed with Warnings',
          `Uploaded ${result.uploaded} of ${result.total} files.\n\n${result.failed} file(s) failed:\n${result.errors[0] || 'Unknown error'}`
        );
      } else {
        Alert.alert(
          'Upload Failed',
          `${result.failed} file(s) failed to upload:\n${result.errors[0] || 'Unknown error'}`
        );
      }
    } catch (error: any) {
      loadData();
      const msg = error.message || 'Upload process failed';
      if (msg.includes('NOT_LOGGED_IN')) {
        Alert.alert(
          'Telegram Not Connected',
          'You need to connect your Telegram account first to upload files.',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Connect Telegram',
              onPress: () => router.push('/telegram-login'),
            },
          ]
        );
      } else if (msg.includes('NO_INTERNET')) {
        Alert.alert('No Internet Connection', 'Please check your WiFi or mobile data connection and try again.');
      } else if (msg.includes('EMPTY_QUEUE') || msg.includes('ALL_FAILED')) {
        Alert.alert('Queue Notice', msg.replace(/^[A-Z_]+:\s*/, ''));
      } else {
        Alert.alert('Upload Error', msg);
      }
    } finally {
      setUploading(false);
    }
  };

  const handleUploadSingleQueueItem = async (item: QueueItem) => {
    setUploading(true);
    try {
      await uploadManager.uploadSingleItem(item);
      loadData();
      Alert.alert('Success', `"${item.fileName}" uploaded successfully!`);
    } catch (error: any) {
      loadData();
      const msg = error.message || 'Failed to upload item';
      if (msg.includes('NOT_LOGGED_IN')) {
        Alert.alert(
          'Telegram Not Connected',
          'Please connect your Telegram account first.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Connect Telegram', onPress: () => router.push('/telegram-login') },
          ]
        );
      } else {
        Alert.alert('Upload Error', msg);
      }
    } finally {
      setUploading(false);
    }
  };

  const handleRetryItem = async (item: QueueItem | ActionHistoryItem) => {
    setUploading(true);
    try {
      const queueItems = await getQueue();
      const isQueueItem = queueItems.some((q) => q.id === item.id);
      if (isQueueItem) {
        await uploadManager.retryItem(item.id);
        loadData();
        Alert.alert('Success', `"${item.fileName}" uploaded successfully!`);
      } else {
        await addToQueue({
          uri: item.uri,
          fileName: item.fileName,
          size: item.size,
        });
        await uploadManager.processQueue({ forceManual: true });
        loadData();
        Alert.alert('Success', `"${item.fileName}" re-queued and uploaded!`);
      }
    } catch (error: any) {
      loadData();
      const msg = error.message || 'Retry failed';
      if (msg.includes('NOT_LOGGED_IN')) {
        Alert.alert(
          'Telegram Not Connected',
          'Please connect your Telegram account first.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Connect Telegram', onPress: () => router.push('/telegram-login') },
          ]
        );
      } else {
        Alert.alert('Upload Error', msg);
      }
    } finally {
      setUploading(false);
    }
  };

  const clearCompleted = async () => {
    await uploadManager.clearCompleted();
    loadData();
  };

  const handleDiscardItem = async (item: { id: string }) => {
    await removeFromQueue(item.id, true);
    loadData();
  };

  const handleDiscardAll = async () => {
    if (queue.length === 0) return;
    Alert.alert(
      'Discard All',
      `Are you sure you want to remove all ${queue.length} files from the queue?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Discard All',
          style: 'destructive',
          onPress: async () => {
            await clearAllQueue(false);
            loadData();
          },
        },
      ]
    );
  };

  const handleClearHistory = async () => {
    Alert.alert(
      'Clear History',
      'Are you sure you want to clear your entire upload history log?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear All',
          style: 'destructive',
          onPress: async () => {
            await clearActionHistory();
            loadData();
          },
        },
      ]
    );
  };

  // Queue metrics
  const totalQueueBytes = queue.reduce((sum, item) => sum + (item.size || 0), 0);
  const pendingItems = queue.filter((item) => item.status === 'pending');
  const pendingBytes = pendingItems.reduce((sum, item) => sum + (item.size || 0), 0);
  const completedItems = queue.filter((item) => item.status === 'completed');
  const completedBytes = completedItems.reduce((sum, item) => sum + (item.size || 0), 0);

  const completedWithTime = completedItems.filter(
    (i) => i.uploadDurationMs && i.uploadDurationMs > 0 && i.size > 0
  );
  const totalCompletedUploadMs = completedWithTime.reduce(
    (sum, i) => sum + (i.uploadDurationMs || 0),
    0
  );
  const totalCompletedBytesWithTime = completedWithTime.reduce((sum, i) => sum + i.size, 0);
  const queueAvgSpeed =
    totalCompletedUploadMs > 0
      ? (totalCompletedBytesWithTime / (totalCompletedUploadMs / 1000))
      : 0;

  const queueCategoryCounts = queue.reduce(
    (acc, item) => {
      const cat = getFileCategory(item.fileName, item.mimeType);
      if (cat in acc) acc[cat as keyof typeof acc]++;
      return acc;
    },
    { image: 0, video: 0, audio: 0, document: 0, other: 0 }
  );

  const filteredQueue = queue.filter((item) => {
    if (queueFilter === 'all') return true;
    return getFileCategory(item.fileName, item.mimeType) === queueFilter;
  });

  const displayedQueue = queueShowAll
    ? filteredQueue
    : filteredQueue.slice(0, PAGE_SIZE);

  // History metrics
  const uploadedHistoryItems = history.filter((h) => h.status === 'uploaded');
  const totalUploadedBytes = uploadedHistoryItems.reduce((sum, item) => sum + (item.size || 0), 0);
  const totalUploadTimeMs = uploadedHistoryItems.reduce(
    (sum, item) => sum + (item.uploadDurationMs || 0),
    0
  );
  const itemsWithDuration = uploadedHistoryItems.filter(
    (h) => h.uploadDurationMs && h.uploadDurationMs > 0 && h.size > 0
  );
  const totalBytesWithDuration = itemsWithDuration.reduce((sum, h) => sum + h.size, 0);
  const totalTimeSeconds = itemsWithDuration.reduce((sum, h) => sum + (h.uploadDurationMs || 0), 0) / 1000;
  const avgUploadSpeed = totalTimeSeconds > 0 ? totalBytesWithDuration / totalTimeSeconds : 0;

  const filteredHistory = history.filter((item) => {
    if (historyFilter === 'all') return true;
    return item.status === historyFilter;
  });

  const displayedHistory = historyShowAll
    ? filteredHistory
    : filteredHistory.slice(0, PAGE_SIZE);

  const formatTimestamp = (ts: number) => {
    const d = new Date(ts);
    const date = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    return `${date} ${time}`;
  };

  const getStatusColor = (status: QueueItem['status']) => {
    switch (status) {
      case 'completed': return '#4CAF50';
      case 'uploading': return '#208AEF';
      case 'failed': return '#F44336';
      case 'paused': return '#FF9800';
      default: return '#757575';
    }
  };

  const getActionColor = (status: ActionHistoryItem['status']) => {
    switch (status) {
      case 'uploaded': return '#4CAF50';
      case 'failed': return '#F44336';
      case 'dismissed': return '#FF9800';
      default: return '#757575';
    }
  };

  const renderQueueItem = ({ item }: { item: QueueItem }) => (
    <TouchableOpacity
      style={styles.item}
      activeOpacity={0.7}
      onPress={() => setSelectedFileForDetails({ ...item, isHistory: false })}
    >
      <View style={styles.itemHeader}>
        <View style={styles.itemIconCol}>
          <Text style={styles.itemTypeIcon}>
            {getFileCategory(item.fileName, item.mimeType) === 'image'
              ? '🖼️'
              : getFileCategory(item.fileName, item.mimeType) === 'video'
              ? '🎥'
              : getFileCategory(item.fileName, item.mimeType) === 'audio'
              ? '🎵'
              : '📄'}
          </Text>
        </View>
        <View style={styles.itemInfo}>
          <Text style={styles.fileName} numberOfLines={1}>
            {item.fileName}
          </Text>
          <View style={styles.metaRow}>
            <Text style={styles.metaText}>{formatFileSize(item.size)}</Text>
            {item.status === 'uploading' && (
              <Text style={styles.metaProgressText}>• {item.progress}%</Text>
            )}
            {item.uploadDurationMs && item.uploadDurationMs > 0 && item.status === 'completed' && (
              <Text style={styles.metaDurationText}>
                • {formatDuration(item.uploadDurationMs)}
              </Text>
            )}
          </View>
        </View>
        <View style={styles.itemStatusRight}>
          <View style={[styles.statusBadge, { backgroundColor: getStatusColor(item.status) + '15' }]}>
            <Text style={[styles.statusText, { color: getStatusColor(item.status) }]}>
              {item.status.toUpperCase()}
            </Text>
          </View>
          {item.status === 'pending' && (
            <TouchableOpacity
              style={styles.itemUploadBtn}
              onPress={(e) => {
                e.stopPropagation();
                handleUploadSingleQueueItem(item);
              }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.itemUploadBtnText}>🚀</Text>
            </TouchableOpacity>
          )}
          {item.status === 'failed' && (
            <TouchableOpacity
              style={[styles.itemUploadBtn, { backgroundColor: '#FEE2E2' }]}
              onPress={(e) => {
                e.stopPropagation();
                handleRetryItem(item);
              }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={[styles.itemUploadBtnText, { color: '#DC2626' }]}>↻</Text>
            </TouchableOpacity>
          )}
          {item.status === 'pending' && (
            <TouchableOpacity
              style={styles.discardButton}
              onPress={(e) => {
                e.stopPropagation();
                handleDiscardItem(item);
              }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.discardButtonText}>✕</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
      {item.status === 'uploading' && (
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: `${item.progress}%` }]} />
        </View>
      )}
      {item.error && <Text style={styles.errorText} numberOfLines={2}>{item.error}</Text>}
    </TouchableOpacity>
  );

  const renderHistoryItem = ({ item }: { item: ActionHistoryItem }) => (
    <TouchableOpacity
      style={styles.historyItem}
      activeOpacity={0.7}
      onPress={() => setSelectedFileForDetails({ ...item, isHistory: true })}
    >
      <View style={styles.historyRow}>
        <View style={styles.itemIconCol}>
          <Text style={styles.itemTypeIcon}>
            {getFileCategory(item.fileName) === 'image'
              ? '🖼️'
              : getFileCategory(item.fileName) === 'video'
              ? '🎥'
              : getFileCategory(item.fileName) === 'audio'
              ? '🎵'
              : '📄'}
          </Text>
        </View>
        <View style={styles.historyInfo}>
          <Text style={styles.historyFileName} numberOfLines={1}>
            {item.fileName}
          </Text>
          <View style={styles.historyMetaRow}>
            <View style={styles.sizePill}>
              <Text style={styles.sizePillText}>{formatFileSize(item.size)}</Text>
            </View>
            <Text style={styles.timeMetaText} numberOfLines={1}>
              {formatTimestamp(item.timestamp)}
              {item.uploadDurationMs && item.uploadDurationMs > 0
                ? ` • ${formatDuration(item.uploadDurationMs)}`
                : ''}
            </Text>
            {item.destination && (
              <Text style={styles.historyDestText} numberOfLines={1}>
                → {item.destination}
              </Text>
            )}
          </View>
        </View>
        <View style={[styles.statusTag, { backgroundColor: getActionColor(item.status) + '18' }]}>
          <Text style={[styles.statusTagText, { color: getActionColor(item.status) }]}>
            {item.status === 'uploaded' ? '✓ DONE' : item.status.toUpperCase()}
          </Text>
        </View>
      </View>
      {item.status === 'failed' && (
        <View style={styles.retryRow}>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={(e) => {
              e.stopPropagation();
              handleRetryItem(item);
            }}
          >
            <Text style={styles.retryButtonText}>↻ Retry Upload</Text>
          </TouchableOpacity>
        </View>
      )}
    </TouchableOpacity>
  );

  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  // Render unified header (replaces outer ScrollView)
  const renderHeader = () => (
    <View>
      {/* Telegram Destination Selector */}
      <DestinationSelector />

      {/* Action Buttons Grid */}
      <View style={styles.actionGrid}>
        <TouchableOpacity
          style={[styles.actionCard, styles.actionCardBlue]}
          onPress={handlePickSingleFile}
        >
          <Text style={styles.actionCardIcon}>📄</Text>
          <Text style={styles.actionCardTitle}>Pick Single File</Text>
          <Text style={styles.actionCardSubtitle}>Photo, Video or Doc</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.actionCard, styles.actionCardGreen, watchedFolders.length === 0 ? { borderWidth: 2, borderColor: '#3B82F6' } : null]}
          onPress={() => setFolderModalVisible(true)}
        >
          <Text style={styles.actionCardIcon}>📁</Text>
          <Text style={styles.actionCardTitle}>Browse Folder</Text>
          <Text style={styles.actionCardSubtitle}>Filter & Multi-Select</Text>
        </TouchableOpacity>
      </View>

      {/* Watched Folders Row */}
      <View style={styles.watchedFoldersContainer}>
        <View style={styles.watchedFoldersHeader}>
          <Text style={styles.watchedFoldersTitle}>
            📁 Watched Folders ({watchedFolders.length})
          </Text>
          <TouchableOpacity
            onPress={() => setFolderModalVisible(true)}
            style={styles.manageFoldersBtn}
          >
            <Text style={styles.manageFoldersBtnText}>
              {watchedFolders.length > 0 ? 'Edit Folders ›' : '+ Choose Folders ›'}
            </Text>
          </TouchableOpacity>
        </View>
        {watchedFolders.length === 0 ? (
          <TouchableOpacity onPress={() => setFolderModalVisible(true)} style={{ alignSelf: 'flex-start' }}>
            <Text style={[styles.noWatchedText, { color: '#3B82F6', fontWeight: '600' }]}>
              No folders chosen yet. Tap to choose folders.
            </Text>
          </TouchableOpacity>
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.watchedChipsScroll}
          >
            {watchedFolders.map((f) => (
              <View key={f.id} style={styles.watchedChip}>
                <Text style={styles.watchedChipIcon}>{f.type === 'saf' ? '📂' : '📁'}</Text>
                <Text style={styles.watchedChipText} numberOfLines={1}>
                  {f.title}
                </Text>
              </View>
            ))}
          </ScrollView>
        )}
      </View>

      {/* Scan & Upload Action Buttons */}
      <View style={styles.buttonRow}>
        {scanning ? (
          <TouchableOpacity style={styles.abortButton} onPress={abortScan}>
            <Text style={styles.abortButtonText}>🛑 Abort Scan</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.secondaryButton, watchedFolders.length === 0 ? { backgroundColor: '#3B82F6' } : null]}
            onPress={() => {
              if (watchedFolders.length === 0) { setFolderModalVisible(true); return; }
              scanAndQueueAll();
            }}
          >
            <Text style={styles.secondaryButtonText}>
              ⚡ Scan Folders ({watchedFolders.length})
            </Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={[styles.uploadButton, (uploading || scanning) && styles.buttonDisabled]}
          onPress={startUpload}
          disabled={uploading || scanning}
        >
          <Text style={styles.uploadButtonText}>
            {uploading ? 'Uploading...' : '🚀 Upload Now'}
          </Text>
        </TouchableOpacity>
      </View>

      {scanning && !!scanStatusText && (
        <View style={styles.scanningBanner}>
          <ActivityIndicator size="small" color="#208AEF" />
          <Text style={styles.scanningBannerText}>{scanStatusText}</Text>
        </View>
      )}

      {/* Tabs: Queue vs History */}
      <View style={styles.tabContainer}>
        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'queue' && styles.tabButtonActive]}
          onPress={() => setActiveTab('queue')}
        >
          <Text style={[styles.tabButtonText, activeTab === 'queue' && styles.tabButtonTextActive]}>
            Queue ({queue.length})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'history' && styles.tabButtonActive]}
          onPress={() => setActiveTab('history')}
        >
          <Text style={[styles.tabButtonText, activeTab === 'history' && styles.tabButtonTextActive]}>
            History ({history.length})
          </Text>
        </TouchableOpacity>
      </View>

      {activeTab === 'queue' ? (
        <>
          {/* Total File Size & Queue Summary Banner */}
          <View style={styles.statsBanner}>
            <View style={styles.statsCol}>
              <Text style={styles.statsLabel}>Total Queue Size</Text>
              <Text style={styles.statsValue}>{formatFileSize(totalQueueBytes)}</Text>
              <Text style={styles.statsSub}>{queue.length} files total</Text>
            </View>
            <View style={styles.statsDivider} />
            <View style={styles.statsCol}>
              <Text style={styles.statsLabel}>Pending Upload</Text>
              <Text style={[styles.statsValue, { color: '#208AEF' }]}>
                {formatFileSize(pendingBytes)}
              </Text>
              <Text style={styles.statsSub}>{pendingItems.length} files left</Text>
            </View>
            <View style={styles.statsDivider} />
            <View style={styles.statsCol}>
              <Text style={styles.statsLabel}>
                {queueAvgSpeed > 0 ? 'Avg Speed' : 'Completed'}
              </Text>
              <Text style={[styles.statsValue, { color: '#4CAF50' }]}>
                {queueAvgSpeed > 0 ? formatSpeed(queueAvgSpeed) : formatFileSize(completedBytes)}
              </Text>
              <Text style={styles.statsSub}>{completedItems.length} uploaded</Text>
            </View>
          </View>

          {/* Queue File Type Filter Chips */}
          <View style={styles.filterChipRow}>
            <TouchableOpacity
              style={[styles.filterChip, queueFilter === 'all' && styles.filterChipActive]}
              onPress={() => setQueueFilter('all')}
            >
              <Text style={[styles.filterChipText, queueFilter === 'all' && styles.filterChipTextActive]}>
                All ({queue.length})
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.filterChip, queueFilter === 'image' && styles.filterChipActive]}
              onPress={() => setQueueFilter('image')}
            >
              <Text style={[styles.filterChipText, queueFilter === 'image' && styles.filterChipTextActive]}>
                🖼️ Images ({queueCategoryCounts.image})
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.filterChip, queueFilter === 'video' && styles.filterChipActive]}
              onPress={() => setQueueFilter('video')}
            >
              <Text style={[styles.filterChipText, queueFilter === 'video' && styles.filterChipTextActive]}>
                🎥 Videos ({queueCategoryCounts.video})
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.filterChip, queueFilter === 'audio' && styles.filterChipActive]}
              onPress={() => setQueueFilter('audio')}
            >
              <Text style={[styles.filterChipText, queueFilter === 'audio' && styles.filterChipTextActive]}>
                🎵 Audio ({queueCategoryCounts.audio})
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.filterChip, queueFilter === 'document' && styles.filterChipActive]}
              onPress={() => setQueueFilter('document')}
            >
              <Text style={[styles.filterChipText, queueFilter === 'document' && styles.filterChipTextActive]}>
                📄 Docs ({queueCategoryCounts.document})
              </Text>
            </TouchableOpacity>
          </View>

          {/* Queue Section Header */}
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionHeaderTitle}>
              Queue List ({filteredQueue.length}{filteredQueue.length !== queue.length ? ` of ${queue.length}` : ''})
            </Text>
            <View style={styles.headerBtnGroup}>
              {filteredQueue.length > PAGE_SIZE && (
                <TouchableOpacity onPress={() => setQueueShowAll(!queueShowAll)}>
                  <Text style={styles.linkText}>
                    {queueShowAll ? 'Show 20' : `Show All (${filteredQueue.length})`}
                  </Text>
                </TouchableOpacity>
              )}
              {queue.some((i) => i.status === 'completed') && (
                <TouchableOpacity onPress={clearCompleted}>
                  <Text style={styles.linkText}>Clear Done</Text>
                </TouchableOpacity>
              )}
              {queue.length > 0 && (
                <TouchableOpacity onPress={handleDiscardAll}>
                  <Text style={styles.dangerLinkText}>Discard All</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </>
      ) : (
        <>
          {/* History Total Stats Banner */}
          <View style={styles.statsBanner}>
            <View style={styles.statsCol}>
              <Text style={styles.statsLabel}>Total Uploaded</Text>
              <Text style={[styles.statsValue, { color: '#4CAF50' }]}>
                {formatFileSize(totalUploadedBytes)}
              </Text>
              <Text style={styles.statsSub}>{uploadedHistoryItems.length} files saved</Text>
            </View>
            <View style={styles.statsDivider} />
            <View style={styles.statsCol}>
              <Text style={styles.statsLabel}>Time Taken</Text>
              <Text style={[styles.statsValue, { color: '#D97706' }]}>
                {formatDuration(totalUploadTimeMs) || '0s'}
              </Text>
              <Text style={styles.statsSub}>total upload time</Text>
            </View>
            <View style={styles.statsDivider} />
            <View style={styles.statsCol}>
              <Text style={styles.statsLabel}>Avg Speed</Text>
              <Text style={[styles.statsValue, { color: '#0284C7' }]}>
                {formatSpeed(avgUploadSpeed)}
              </Text>
              <Text style={styles.statsSub}>transfer rate</Text>
            </View>
          </View>

          {/* History Status Filters */}
          <View style={styles.filterChipRow}>
            <TouchableOpacity
              style={[styles.filterChip, historyFilter === 'all' && styles.filterChipActive]}
              onPress={() => setHistoryFilter('all')}
            >
              <Text style={[styles.filterChipText, historyFilter === 'all' && styles.filterChipTextActive]}>
                All ({history.length})
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.filterChip, historyFilter === 'uploaded' && styles.filterChipActive]}
              onPress={() => setHistoryFilter('uploaded')}
            >
              <Text style={[styles.filterChipText, historyFilter === 'uploaded' && styles.filterChipTextActive]}>
                ✓ Uploaded ({uploadedHistoryItems.length})
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.filterChip, historyFilter === 'failed' && styles.filterChipActive]}
              onPress={() => setHistoryFilter('failed')}
            >
              <Text style={[styles.filterChipText, historyFilter === 'failed' && styles.filterChipTextActive]}>
                ✕ Failed
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.filterChip, historyFilter === 'dismissed' && styles.filterChipActive]}
              onPress={() => setHistoryFilter('dismissed')}
            >
              <Text style={[styles.filterChipText, historyFilter === 'dismissed' && styles.filterChipTextActive]}>
                ⊘ Dismissed
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionHeaderTitle}>
              History Records ({filteredHistory.length})
            </Text>
            <View style={styles.headerBtnGroup}>
              {filteredHistory.length > PAGE_SIZE && (
                <TouchableOpacity onPress={() => setHistoryShowAll(!historyShowAll)}>
                  <Text style={styles.linkText}>
                    {historyShowAll ? 'Show 20' : `Show All (${filteredHistory.length})`}
                  </Text>
                </TouchableOpacity>
              )}
              {history.length > 0 && (
                <TouchableOpacity onPress={handleClearHistory}>
                  <Text style={styles.dangerLinkText}>Clear History</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </>
      )}
    </View>
  );

  const renderFooter = () => {
    if (activeTab === 'queue' && filteredQueue.length > PAGE_SIZE) {
      return (
        <View style={styles.paginationFooter}>
          <Text style={styles.paginationText}>
            Showing {displayedQueue.length} of {filteredQueue.length} files
          </Text>
          <TouchableOpacity
            style={styles.paginationBtn}
            onPress={() => setQueueShowAll(!queueShowAll)}
          >
            <Text style={styles.paginationBtnText}>
              {queueShowAll ? '🔼 Show 20 by default' : `🔽 Show All (${filteredQueue.length} files)`}
            </Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (activeTab === 'history' && filteredHistory.length > PAGE_SIZE) {
      return (
        <View style={styles.paginationFooter}>
          <Text style={styles.paginationText}>
            Showing {displayedHistory.length} of {filteredHistory.length} records
          </Text>
          <TouchableOpacity
            style={styles.paginationBtn}
            onPress={() => setHistoryShowAll(!historyShowAll)}
          >
            <Text style={styles.paginationBtnText}>
              {historyShowAll ? '🔼 Show 20 by default' : `🔽 Show All (${filteredHistory.length} records)`}
            </Text>
          </TouchableOpacity>
        </View>
      );
    }

    return null;
  };

  const renderEmpty = () => {
    if (activeTab === 'queue') {
      return (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>📭</Text>
          <Text style={styles.emptyText}>No files in upload queue</Text>
          <Text style={styles.emptySubtext}>
            {queueFilter !== 'all'
              ? `No ${queueFilter} files match the current filter.`
              : 'Use the buttons above to select files or a folder to upload.'}
          </Text>
        </View>
      );
    }

    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyIcon}>📜</Text>
        <Text style={styles.emptyText}>No history records</Text>
        <Text style={styles.emptySubtext}>
          Actions like uploaded, failed, and dismissed files will appear here.
        </Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <Stack.Screen
        options={{
          headerTitle: () => (
            <View style={styles.navHeaderTitleContainer}>
              <Image
                source={require('@/assets/images/app-logo.png')}
                style={styles.navHeaderLogo}
              />
              <View style={styles.navHeaderTextContainer}>
                <Text
                  style={[styles.navHeaderTitle, { color: isDark ? '#FFFFFF' : '#111827' }]}
                  numberOfLines={1}
                >
                  Upload Manager
                </Text>
                <Text
                  style={[styles.navHeaderSubtitle, { color: isDark ? '#9CA3AF' : '#6B7280' }]}
                  numberOfLines={1}
                >
                  Queue & Action History
                </Text>
              </View>
            </View>
          ),
          headerRight: () => (
            <TouchableOpacity
              onPress={() => router.push('/settings')}
              style={styles.navSettingsButton}
              activeOpacity={0.7}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Text style={styles.navSettingsIcon}>⚙️</Text>
            </TouchableOpacity>
          ),
        }}
      />

      {/* Top-level FlatList: Eliminates nested VirtualizedList inside ScrollView error */}
      <FlatList
        style={styles.container}
        contentContainerStyle={styles.content}
        data={activeTab === 'queue' ? (displayedQueue as any) : (displayedHistory as any)}
        renderItem={activeTab === 'queue' ? (renderQueueItem as any) : (renderHistoryItem as any)}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={renderHeader}
        ListFooterComponent={renderFooter}
        ListEmptyComponent={renderEmpty}
      />

      {/* Folder Browser Modal */}
      <FolderBrowserModal
        visible={folderModalVisible}
        onClose={() => setFolderModalVisible(false)}
        onFilesSelected={handleFolderFilesSelected}
        onWatchedFoldersUpdated={(folders) => setWatchedFolders(folders)}
        onScanFoldersRequested={(folders) => {
          setWatchedFolders(folders);
          scanAndQueueAll(folders);
        }}
      />

      {/* File Details Popup Modal */}
      <FileDetailsModal
        visible={!!selectedFileForDetails}
        file={selectedFileForDetails}
        onClose={() => setSelectedFileForDetails(null)}
        onUploadNow={async (file) => {
          setSelectedFileForDetails(null);
          if (file.id) {
            const queueItems = await getQueue();
            const qItem = queueItems.find((q) => q.id === file.id);
            if (qItem) {
              handleUploadSingleQueueItem(qItem);
              return;
            }
          }
          startUpload();
        }}
        onDiscard={(file) => {
          if (file.id) {
            handleDiscardItem({ id: file.id });
          }
        }}
        onRetry={(file) => {
          handleRetryItem(file as any);
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  navHeaderTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
  },
  navHeaderLogo: {
    width: 38,
    height: 38,
    borderRadius: 8,
    marginRight: 10,
  },
  navHeaderTextContainer: {
    justifyContent: 'center',
  },
  navHeaderTitle: {
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  navHeaderSubtitle: {
    fontSize: 12,
    fontWeight: '400',
    marginTop: 1,
  },
  navSettingsButton: {
    padding: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  navSettingsIcon: {
    fontSize: 22,
  },
  actionGrid: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  actionCard: {
    flex: 1,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  actionCardBlue: {
    backgroundColor: '#EBF4FE',
    borderWidth: 1,
    borderColor: '#B9D9FA',
  },
  actionCardGreen: {
    backgroundColor: '#EBF9F1',
    borderWidth: 1,
    borderColor: '#B9EED0',
  },
  actionCardIcon: {
    fontSize: 24,
    marginBottom: 8,
  },
  actionCardTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 2,
  },
  actionCardSubtitle: {
    fontSize: 11,
    color: '#666',
  },
  watchedFoldersContainer: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e5e5e5',
  },
  watchedFoldersHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  watchedFoldersTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#222',
  },
  manageFoldersBtn: {
    paddingVertical: 2,
    paddingHorizontal: 6,
  },
  manageFoldersBtnText: {
    fontSize: 13,
    color: '#208AEF',
    fontWeight: '600',
  },
  noWatchedText: {
    fontSize: 12,
    color: '#888',
    fontStyle: 'italic',
  },
  watchedChipsScroll: {
    flexDirection: 'row',
  },
  watchedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F0F7FF',
    borderColor: '#B9D9FA',
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginRight: 8,
  },
  watchedChipIcon: {
    fontSize: 13,
    marginRight: 4,
  },
  watchedChipText: {
    fontSize: 12,
    color: '#1a5ea8',
    fontWeight: '600',
    maxWidth: 120,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  secondaryButton: {
    flex: 1,
    backgroundColor: '#fff',
    paddingVertical: 14,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: '#208AEF',
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#208AEF',
    fontSize: 14,
    fontWeight: 'bold',
  },
  abortButton: {
    flex: 1,
    backgroundColor: '#E53E3E',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  abortButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: 'bold',
  },
  uploadButton: {
    flex: 1,
    backgroundColor: '#208AEF',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  uploadButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: 'bold',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  scanningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F0F7FF',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 12,
    gap: 8,
  },
  scanningBannerText: {
    fontSize: 13,
    color: '#208AEF',
    fontWeight: '500',
  },
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: '#e5e7eb',
    borderRadius: 8,
    padding: 3,
    marginBottom: 16,
  },
  tabButton: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 6,
  },
  tabButtonActive: {
    backgroundColor: '#fff',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  tabButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#666',
  },
  tabButtonTextActive: {
    color: '#208AEF',
    fontWeight: 'bold',
  },
  statsBanner: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    alignItems: 'center',
    justifyContent: 'space-between',
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
  },
  statsCol: {
    flex: 1,
    alignItems: 'center',
  },
  statsDivider: {
    width: 1,
    height: 36,
    backgroundColor: '#e5e7eb',
  },
  statsLabel: {
    fontSize: 11,
    color: '#888',
    marginBottom: 2,
    textTransform: 'uppercase',
    fontWeight: '600',
  },
  statsValue: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#111',
  },
  statsSub: {
    fontSize: 10,
    color: '#999',
    marginTop: 1,
  },
  filterChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 12,
  },
  filterChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 16,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  filterChipActive: {
    backgroundColor: '#208AEF',
    borderColor: '#208AEF',
  },
  filterChipText: {
    fontSize: 12,
    color: '#666',
    fontWeight: '500',
  },
  filterChipTextActive: {
    color: '#fff',
    fontWeight: 'bold',
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  sectionHeaderTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
  },
  headerBtnGroup: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
  },
  linkText: {
    color: '#208AEF',
    fontSize: 13,
    fontWeight: '600',
  },
  dangerLinkText: {
    color: '#F44336',
    fontSize: 13,
    fontWeight: '600',
  },
  item: {
    backgroundColor: '#fff',
    padding: 12,
    borderRadius: 10,
    marginBottom: 8,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
  },
  itemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  itemIconCol: {
    marginRight: 10,
  },
  itemTypeIcon: {
    fontSize: 22,
  },
  itemInfo: {
    flex: 1,
    marginRight: 8,
  },
  fileName: {
    fontSize: 14,
    fontWeight: '500',
    color: '#222',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  metaText: {
    fontSize: 12,
    color: '#666',
  },
  metaProgressText: {
    fontSize: 12,
    color: '#208AEF',
    fontWeight: '600',
    marginLeft: 4,
  },
  metaDurationText: {
    fontSize: 12,
    color: '#4CAF50',
    fontWeight: '500',
    marginLeft: 4,
  },
  itemStatusRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 11,
    fontWeight: 'bold',
  },
  itemUploadBtn: {
    backgroundColor: '#EBF4FE',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    marginRight: 4,
  },
  itemUploadBtnText: {
    fontSize: 12,
  },
  discardButton: {
    padding: 4,
  },
  discardButtonText: {
    color: '#999',
    fontSize: 14,
    fontWeight: 'bold',
  },
  historyItem: {
    backgroundColor: '#fff',
    padding: 12,
    borderRadius: 10,
    marginBottom: 8,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  historyInfo: {
    flex: 1,
    marginRight: 8,
  },
  historyFileName: {
    fontSize: 14,
    fontWeight: '500',
    color: '#222',
  },
  historyMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 3,
    gap: 8,
    flexWrap: 'nowrap',
  },
  sizePill: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  sizePillText: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#334155',
  },
  timeMetaText: {
    fontSize: 11,
    color: '#64748B',
    flex: 1,
  },
  historyDestText: {
    fontSize: 11,
    color: '#208AEF',
    fontWeight: '600',
    maxWidth: '35%',
  },
  statusTag: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  statusTagText: {
    fontSize: 10,
    fontWeight: 'bold',
  },
  retryRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 6,
  },
  retryButton: {
    backgroundColor: '#EBF4FE',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 6,
  },
  retryButtonText: {
    color: '#208AEF',
    fontSize: 12,
    fontWeight: '600',
  },
  progressBar: {
    height: 4,
    backgroundColor: '#e5e7eb',
    borderRadius: 2,
    overflow: 'hidden',
    marginTop: 6,
    marginLeft: 32,
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#208AEF',
  },
  errorText: {
    fontSize: 11,
    color: '#F44336',
    marginTop: 4,
    marginLeft: 32,
  },
  paginationFooter: {
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    marginTop: 8,
    marginBottom: 20,
  },
  paginationText: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '500',
  },
  paginationBtn: {
    backgroundColor: '#EEF2FF',
    borderWidth: 1,
    borderColor: '#C7D2FE',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    marginTop: 2,
  },
  paginationBtnText: {
    color: '#4F46E5',
    fontSize: 12,
    fontWeight: 'bold',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 36,
  },
  emptyIcon: {
    fontSize: 34,
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#666',
  },
  emptySubtext: {
    fontSize: 12,
    color: '#999',
    marginTop: 4,
    textAlign: 'center',
    paddingHorizontal: 20,
  },
});
