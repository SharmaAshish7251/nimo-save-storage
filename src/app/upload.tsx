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

      // Show Expo popup modal with file details and action buttons instead of native alert
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
      await uploadManager.processQueue();
      Alert.alert('Success', 'Upload process completed');
      loadData();
    } catch (error: any) {
      Alert.alert('Error', error.message);
    } finally {
      setUploading(false);
    }
  };

  const clearCompleted = async () => {
    await uploadManager.clearCompleted();
    loadData();
  };

  const handleDiscardItem = async (item: { id: string }) => {
    await uploadManager.discardItem(item.id);
    loadData();
  };

  const handleDiscardAll = () => {
    Alert.alert(
      'Discard All',
      'Are you sure you want to discard all pending files in the upload queue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Discard All',
          style: 'destructive',
          onPress: async () => {
            await uploadManager.discardAll();
            loadData();
          },
        },
      ]
    );
  };

  const handleClearHistory = () => {
    Alert.alert(
      'Clear History',
      'Delete all action history records?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear History',
          style: 'destructive',
          onPress: async () => {
            await clearActionHistory();
            loadData();
          },
        },
      ]
    );
  };

  const handleRetryItem = async (item: ActionHistoryItem) => {
    await addToQueue({
      uri: item.uri,
      fileName: item.fileName,
      size: item.size,
    });
    setActiveTab('queue');
    loadData();
    Alert.alert('Queued', `"${item.fileName}" has been re-added to the upload queue.`);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
      case 'uploaded': return '#4CAF50';
      case 'uploading': return '#FF9800';
      case 'failed': return '#F44336';
      case 'pending': return '#208AEF';
      case 'dismissed': return '#888888';
      default: return '#666';
    }
  };

  const getFileIcon = (fileName: string, mimeType?: string) => {
    const cat = getFileCategory(fileName, mimeType);
    switch (cat) {
      case 'image': return '🖼️';
      case 'video': return '🎥';
      case 'audio': return '🎵';
      case 'document': return '📄';
      default: return '📦';
    }
  };

  const formatTimestamp = (ts?: number) => {
    if (!ts) return '';
    const d = new Date(ts);
    const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const today = new Date();
    const isToday =
      d.getDate() === today.getDate() &&
      d.getMonth() === today.getMonth() &&
      d.getFullYear() === today.getFullYear();

    if (isToday) {
      return `Today at ${timeStr}`;
    }
    return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} at ${timeStr}`;
  };

  // Queue Calculations & Filtering
  const queueCategoryCounts = queue.reduce(
    (acc, item) => {
      const cat = getFileCategory(item.fileName, item.mimeType);
      if (cat in acc) acc[cat as keyof typeof acc]++;
      return acc;
    },
    { image: 0, video: 0, audio: 0, document: 0 }
  );

  const filteredQueue = queue.filter((item) => {
    if (queueFilter === 'all') return true;
    return getFileCategory(item.fileName, item.mimeType) === queueFilter;
  });

  const displayedQueue = queueShowAll ? filteredQueue : filteredQueue.slice(0, PAGE_SIZE);

  const totalQueueBytes = queue.reduce((sum, i) => sum + (i.size || 0), 0);
  const pendingItems = queue.filter((i) => i.status === 'pending');
  const pendingBytes = pendingItems.reduce((sum, i) => sum + (i.size || 0), 0);
  const completedItems = queue.filter((i) => i.status === 'completed');
  const completedBytes = completedItems.reduce((sum, i) => sum + (i.size || 0), 0);
  const completedQueueTimeMs = completedItems.reduce((sum, i) => sum + (i.uploadDurationMs || 0), 0);
  const queueAvgSpeed = completedQueueTimeMs > 0 ? (completedBytes / (completedQueueTimeMs / 1000)) : 0;

  // History Calculations & Filtering
  const uploadedHistoryItems = history.filter((i) => i.status === 'uploaded');
  const totalUploadedBytes = uploadedHistoryItems.reduce((sum, i) => sum + (i.size || 0), 0);
  const totalUploadTimeMs = uploadedHistoryItems.reduce((sum, i) => sum + (i.uploadDurationMs || 0), 0);
  const avgUploadSpeed = totalUploadTimeMs > 0 ? (totalUploadedBytes / (totalUploadTimeMs / 1000)) : 0;

  const filteredHistory = history.filter((item) => {
    if (historyFilter === 'all') return true;
    return item.status === historyFilter;
  });
  const displayedHistory = historyShowAll ? filteredHistory : filteredHistory.slice(0, PAGE_SIZE);

  const renderQueueItem = ({ item }: { item: QueueItem }) => (
    <TouchableOpacity
      style={styles.cardItem}
      activeOpacity={0.7}
      onPress={() => setSelectedFileForDetails({ ...item, isHistory: false })}
    >
      <View style={styles.cardHeader}>
        <Text style={styles.itemFileIcon}>
          {getFileIcon(item.fileName, item.mimeType)}
        </Text>
        <View style={styles.fileNameContainer}>
          <Text style={styles.fileName} numberOfLines={1}>
            {item.fileName}
          </Text>
        </View>
        <Text style={[styles.badge, { color: getStatusColor(item.status) }]}>
          {item.status.toUpperCase()}
        </Text>
        {/* Discard Button */}
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
      </View>

      {/* File Size & Upload Time Row */}
      <View style={styles.metaRow}>
        <View style={styles.sizePill}>
          <Text style={styles.sizePillText}>{formatFileSize(item.size)}</Text>
        </View>

        {item.status === 'completed' ? (
          <Text style={[styles.timeMetaText, { color: '#2E7D32' }]} numberOfLines={1}>
            ✓ Uploaded {formatTimestamp(item.uploadedAt || item.lastAttemptAt || item.addedAt)}
            {item.uploadDurationMs ? ` (took ${formatDuration(item.uploadDurationMs)})` : ''}
          </Text>
        ) : item.status === 'uploading' ? (
          <Text style={[styles.timeMetaText, { color: '#E65100' }]} numberOfLines={1}>
            ⚡ Uploading... {item.progress}%
            {item.uploadStartedAt ? ` • Started ${formatTimestamp(item.uploadStartedAt)}` : ''}
          </Text>
        ) : item.status === 'failed' ? (
          <Text style={[styles.timeMetaText, { color: '#C62828' }]} numberOfLines={1}>
            ✕ Failed {item.lastAttemptAt ? `• ${formatTimestamp(item.lastAttemptAt)}` : ''}
            {item.uploadDurationMs ? ` (${formatDuration(item.uploadDurationMs)})` : ''}
          </Text>
        ) : (
          <Text style={styles.timeMetaText} numberOfLines={1}>
            🕒 Added {formatTimestamp(item.addedAt)}
          </Text>
        )}
      </View>

      {item.status === 'uploading' && (
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: `${item.progress}%` }]} />
        </View>
      )}

      {item.error && (
        <Text style={styles.errorText} numberOfLines={2}>
          {item.error}
        </Text>
      )}
    </TouchableOpacity>
  );

  const renderHistoryItem = ({ item }: { item: ActionHistoryItem }) => {
    const itemSpeed = item.uploadDurationMs && item.uploadDurationMs > 0 && item.size > 0
      ? item.size / (item.uploadDurationMs / 1000)
      : 0;

    return (
      <TouchableOpacity
        style={styles.cardItem}
        activeOpacity={0.7}
        onPress={() => setSelectedFileForDetails({ ...item, isHistory: true })}
      >
        <View style={styles.cardHeader}>
          <Text style={styles.itemFileIcon}>{getFileIcon(item.fileName)}</Text>
          <View style={styles.fileNameContainer}>
            <Text style={styles.fileName} numberOfLines={1}>
              {item.fileName}
            </Text>
          </View>
          <View style={[styles.statusTag, { backgroundColor: getStatusColor(item.status) + '1A' }]}>
            <Text style={[styles.statusTagText, { color: getStatusColor(item.status) }]}>
              {item.status === 'uploaded' ? '✓ UPLOADED' : item.status === 'failed' ? '✕ FAILED' : '⊘ DISMISSED'}
            </Text>
          </View>
        </View>

        {/* History File Size, Upload Time & Destination Row */}
        <View style={styles.metaRow}>
          <View style={styles.sizePill}>
            <Text style={styles.sizePillText}>{formatFileSize(item.size)}</Text>
          </View>

          <Text style={styles.timeMetaText} numberOfLines={1}>
            {item.status === 'uploaded' ? '✓ ' : ''}
            {formatTimestamp(item.timestamp)}
            {item.uploadDurationMs ? ` • Took ${formatDuration(item.uploadDurationMs)}` : ''}
            {itemSpeed > 0 ? ` (${formatSpeed(itemSpeed)})` : ''}
          </Text>

          {item.destination && (
            <Text style={styles.historyDestText} numberOfLines={1}>
              → {item.destination}
            </Text>
          )}
        </View>

        {item.error && (
          <Text style={styles.errorText} numberOfLines={2}>
            {item.error}
          </Text>
        )}

        {(item.status === 'failed' || item.status === 'dismissed') && (
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
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView>
        <View style={styles.content}>
          <View style={styles.screenHeader}>
            <Image
              source={require('@/assets/images/app-logo.png')}
              style={styles.headerLogo}
            />
            <View>
              <Text style={styles.title}>Upload Manager</Text>
              <Text style={styles.headerSubtitle}>Queue & Action History</Text>
            </View>
          </View>

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
              style={[styles.actionCard, styles.actionCardGreen]}
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
              <Text style={styles.noWatchedText}>
                No folders chosen yet. Only selected folders will be scanned.
              </Text>
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
                style={styles.secondaryButton}
                onPress={() => scanAndQueueAll()}
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

          {/* VIEW 1: QUEUE TAB */}
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

              <FlatList
                data={displayedQueue}
                renderItem={renderQueueItem}
                keyExtractor={(item) => item.id}
                style={styles.list}
                ListFooterComponent={
                  filteredQueue.length > PAGE_SIZE ? (
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
                  ) : undefined
                }
                ListEmptyComponent={
                  <View style={styles.emptyContainer}>
                    <Text style={styles.emptyIcon}>📭</Text>
                    <Text style={styles.emptyText}>No files in upload queue</Text>
                    <Text style={styles.emptySubtext}>
                      {queueFilter !== 'all'
                        ? `No ${queueFilter} files match the current filter.`
                        : 'Use the buttons above to select files or a folder to upload.'}
                    </Text>
                  </View>
                }
              />
            </>
          ) : (
            /* VIEW 2: HISTORY TAB */
            <>
              {/* Total Uploaded History Summary Banner with Time Taken and Avg Speed */}
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

              <FlatList
                data={displayedHistory}
                renderItem={renderHistoryItem}
                keyExtractor={(item) => item.id}
                style={styles.list}
                ListFooterComponent={
                  filteredHistory.length > PAGE_SIZE ? (
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
                  ) : undefined
                }
                ListEmptyComponent={
                  <View style={styles.emptyContainer}>
                    <Text style={styles.emptyIcon}>📜</Text>
                    <Text style={styles.emptyText}>No history records</Text>
                    <Text style={styles.emptySubtext}>
                      Actions like uploaded, failed, and dismissed files will appear here.
                    </Text>
                  </View>
                }
              />
            </>
          )}

          {/* Folder Browser Modal */}
          <FolderBrowserModal
            visible={folderModalVisible}
            onClose={() => setFolderModalVisible(false)}
            onFilesSelected={handleFolderFilesSelected}
          />

          {/* File Details Popup Modal */}
          <FileDetailsModal
            visible={!!selectedFileForDetails}
            file={selectedFileForDetails}
            onClose={() => setSelectedFileForDetails(null)}
            onDiscard={(file) => {
              if (file.id) {
                handleDiscardItem({ id: file.id });
              }
            }}
            onRetry={(file) => {
              handleRetryItem(file as ActionHistoryItem);
            }}
            onUploadNow={() => {
              startUpload();
            }}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f7fa',
  },
  content: {
    flex: 1,
    padding: 16,
  },
  screenHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  headerLogo: {
    width: 44,
    height: 44,
    borderRadius: 10,
    marginRight: 10,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1a1a1a',
  },
  headerSubtitle: {
    fontSize: 11,
    color: '#666',
  },
  actionGrid: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
  },
  actionCard: {
    flex: 1,
    padding: 14,
    borderRadius: 12,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
    elevation: 2,
  },
  actionCardBlue: {
    backgroundColor: '#EBF4FE',
    borderWidth: 1,
    borderColor: '#D0E3FC',
  },
  actionCardGreen: {
    backgroundColor: '#E8F5E9',
    borderWidth: 1,
    borderColor: '#C8E6C9',
  },
  actionCardIcon: {
    fontSize: 26,
    marginBottom: 6,
  },
  actionCardTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#222',
  },
  actionCardSubtitle: {
    fontSize: 11,
    color: '#666',
    marginTop: 2,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  secondaryButton: {
    flex: 1,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ddd',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#444',
    fontSize: 13,
    fontWeight: '600',
  },
  uploadButton: {
    flex: 1,
    backgroundColor: '#208AEF',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  uploadButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: 'bold',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: '#E5E7EB',
    borderRadius: 8,
    padding: 3,
    marginBottom: 10,
  },
  tabButton: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: 'center',
  },
  tabButtonActive: {
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 2,
    elevation: 2,
  },
  tabButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6B7280',
  },
  tabButtonTextActive: {
    color: '#208AEF',
    fontWeight: 'bold',
  },
  statsBanner: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 10,
    marginBottom: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 2,
    elevation: 1,
  },
  statsCol: {
    flex: 1,
    alignItems: 'center',
  },
  statsDivider: {
    width: 1,
    height: 32,
    backgroundColor: '#E2E8F0',
  },
  statsLabel: {
    fontSize: 10,
    color: '#64748B',
    fontWeight: '600',
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  statsValue: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#1E293B',
  },
  statsSub: {
    fontSize: 10,
    color: '#94A3B8',
    marginTop: 1,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
    marginTop: 2,
  },
  sectionHeaderTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#333',
  },
  headerBtnGroup: {
    flexDirection: 'row',
    gap: 12,
  },
  linkText: {
    color: '#208AEF',
    fontSize: 12,
    fontWeight: '600',
  },
  dangerLinkText: {
    color: '#EF4444',
    fontSize: 12,
    fontWeight: '600',
  },
  filterChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 8,
  },
  filterChip: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 14,
  },
  filterChipActive: {
    backgroundColor: '#208AEF',
    borderColor: '#208AEF',
  },
  filterChipText: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '500',
  },
  filterChipTextActive: {
    color: '#fff',
    fontWeight: 'bold',
  },
  list: {
    flex: 1,
  },
  cardItem: {
    backgroundColor: '#fff',
    padding: 12,
    borderRadius: 10,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 2,
    elevation: 1,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  itemFileIcon: {
    fontSize: 18,
    marginRight: 8,
  },
  fileNameContainer: {
    flex: 1,
    marginRight: 8,
  },
  fileName: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1E293B',
  },
  badge: {
    fontSize: 10,
    fontWeight: 'bold',
    marginRight: 6,
  },
  discardButton: {
    backgroundColor: '#F3F4F6',
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  discardButtonText: {
    fontSize: 12,
    color: '#6B7280',
    fontWeight: 'bold',
    lineHeight: 14,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 26,
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
    marginLeft: 26,
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#208AEF',
  },
  errorText: {
    fontSize: 11,
    color: '#F44336',
    marginTop: 4,
    marginLeft: 26,
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
  emptySubtext: {
    fontSize: 12,
    color: '#999',
    marginTop: 4,
    textAlign: 'center',
    paddingHorizontal: 20,
  },
});