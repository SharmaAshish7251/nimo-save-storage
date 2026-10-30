import React, { useState, useEffect } from 'react';
import {
  View,
  StyleSheet,
  Text,
  TouchableOpacity,
  FlatList,
  Alert,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  getQueue,
  QueueItem,
  addToQueue,
  getActionHistory,
  clearActionHistory,
  ActionHistoryItem,
} from '@/lib/storage/queue';
import { uploadManager } from '@/lib/upload/manager';
import {
  scanForNewFiles,
  pickSingleFile,
  ScannedFile,
  getFileCategory,
} from '@/lib/scanner/files';
import { DestinationSelector } from '@/components/DestinationSelector';
import { FolderBrowserModal } from '@/components/FolderBrowserModal';

type HistoryFilter = 'all' | 'uploaded' | 'failed' | 'dismissed';

export default function UploadScreen() {
  const [activeTab, setActiveTab] = useState<'queue' | 'history'>('queue');
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [history, setHistory] = useState<ActionHistoryItem[]>([]);
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>('all');
  const [scanning, setScanning] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [folderModalVisible, setFolderModalVisible] = useState(false);

  const loadData = async () => {
    const [q, h] = await Promise.all([getQueue(), getActionHistory()]);
    setQueue(q);
    setHistory(h);
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

      await addToQueue({
        uri: file.uri,
        fileName: file.fileName,
        size: file.size,
        mimeType: file.mimeType,
      });
      loadData();

      Alert.alert(
        'File Added',
        `"${file.fileName}" added to queue. Upload now?`,
        [
          { text: 'Later', style: 'cancel' },
          { text: 'Upload Now', onPress: startUpload },
        ]
      );
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to pick file');
    }
  };

  const handleFolderFilesSelected = async (files: ScannedFile[], uploadNow: boolean) => {
    try {
      for (const file of files) {
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
        Alert.alert('Success', `Added ${files.length} selected files to queue`);
      }
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to add files to queue');
    }
  };

  const scanAndQueueAll = async () => {
    setScanning(true);
    try {
      const newFiles = await scanForNewFiles();
      if (newFiles.length === 0) {
        Alert.alert('Info', 'No new files found in media library');
        return;
      }
      for (const file of newFiles) {
        await addToQueue({
          uri: file.uri,
          fileName: file.fileName,
          size: file.size,
          mimeType: file.mimeType,
        });
      }
      Alert.alert('Success', `Added ${newFiles.length} files to queue`);
      loadData();
    } catch (error: any) {
      Alert.alert('Error', error.message);
    } finally {
      setScanning(false);
    }
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

  const handleDiscardItem = async (item: QueueItem) => {
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
      case 'pending': return '#2196F3';
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

  const formatTimestamp = (ts: number) => {
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

  const filteredHistory = history.filter((item) => {
    if (historyFilter === 'all') return true;
    return item.status === historyFilter;
  });

  const renderQueueItem = ({ item }: { item: QueueItem }) => (
    <View style={styles.cardItem}>
      <View style={styles.cardHeader}>
        <Text style={styles.itemFileIcon}>
          {getFileIcon(item.fileName, item.mimeType)}
        </Text>
        <Text style={styles.fileName} numberOfLines={1}>
          {item.fileName}
        </Text>
        <Text style={[styles.badge, { color: getStatusColor(item.status) }]}>
          {item.status.toUpperCase()}
        </Text>
        {/* Discard Button */}
        <TouchableOpacity
          style={styles.discardButton}
          onPress={() => handleDiscardItem(item)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.discardButtonText}>✕</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.fileInfo}>
        {(item.size / 1024 / 1024).toFixed(2)} MB
      </Text>
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
    </View>
  );

  const renderHistoryItem = ({ item }: { item: ActionHistoryItem }) => (
    <View style={styles.cardItem}>
      <View style={styles.cardHeader}>
        <Text style={styles.itemFileIcon}>{getFileIcon(item.fileName)}</Text>
        <Text style={styles.fileName} numberOfLines={1}>
          {item.fileName}
        </Text>
        <View style={[styles.statusTag, { backgroundColor: getStatusColor(item.status) + '1A' }]}>
          <Text style={[styles.statusTagText, { color: getStatusColor(item.status) }]}>
            {item.status === 'uploaded' ? '✓ UPLOADED' : item.status === 'failed' ? '✕ FAILED' : '⊘ DISMISSED'}
          </Text>
        </View>
      </View>

      <View style={styles.historyMetaRow}>
        <Text style={styles.historyMetaText}>
          {(item.size / 1024 / 1024).toFixed(2)} MB • {formatTimestamp(item.timestamp)}
        </Text>
        {item.destination && (
          <Text style={styles.historyDestText} numberOfLines={1}>
            To: {item.destination}
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
            onPress={() => handleRetryItem(item)}
          >
            <Text style={styles.retryButtonText}>↻ Retry Upload</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
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

        {/* Secondary Actions */}
        <View style={styles.buttonRow}>
          <TouchableOpacity
            style={[styles.secondaryButton, scanning && styles.buttonDisabled]}
            onPress={scanAndQueueAll}
            disabled={scanning}
          >
            <Text style={styles.secondaryButtonText}>
              {scanning ? 'Scanning...' : '⚡ Scan All Media'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.uploadButton, uploading && styles.buttonDisabled]}
            onPress={startUpload}
            disabled={uploading}
          >
            <Text style={styles.uploadButtonText}>
              {uploading ? 'Uploading...' : '🚀 Upload Now'}
            </Text>
          </TouchableOpacity>
        </View>

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
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionHeaderTitle}>
                Upload Queue ({queue.length})
              </Text>
              <View style={styles.headerBtnGroup}>
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
              data={queue}
              renderItem={renderQueueItem}
              keyExtractor={(item) => item.id}
              style={styles.list}
              ListEmptyComponent={
                <View style={styles.emptyContainer}>
                  <Text style={styles.emptyIcon}>📭</Text>
                  <Text style={styles.emptyText}>No files in upload queue</Text>
                  <Text style={styles.emptySubtext}>
                    Use the buttons above to select files or a folder to upload.
                  </Text>
                </View>
              }
            />
          </>
        ) : (
          /* VIEW 2: HISTORY TAB */
          <>
            {/* History Filters */}
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
                  ✓ Uploaded
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
                Action History ({filteredHistory.length})
              </Text>
              {history.length > 0 && (
                <TouchableOpacity onPress={handleClearHistory}>
                  <Text style={styles.dangerLinkText}>Clear History</Text>
                </TouchableOpacity>
              )}
            </View>

            <FlatList
              data={filteredHistory}
              renderItem={renderHistoryItem}
              keyExtractor={(item) => item.id}
              style={styles.list}
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
      </View>
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
    marginBottom: 4,
  },
  itemFileIcon: {
    fontSize: 16,
    marginRight: 8,
  },
  fileName: {
    fontSize: 13,
    fontWeight: '600',
    color: '#222',
    flex: 1,
    marginRight: 8,
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
    marginLeft: 4,
  },
  discardButtonText: {
    fontSize: 13,
    color: '#6B7280',
    fontWeight: 'bold',
    lineHeight: 14,
  },
  fileInfo: {
    fontSize: 11,
    color: '#888',
    marginLeft: 24,
  },
  historyMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginLeft: 24,
    marginTop: 2,
  },
  historyMetaText: {
    fontSize: 11,
    color: '#6B7280',
  },
  historyDestText: {
    fontSize: 11,
    color: '#208AEF',
    fontWeight: '500',
    maxWidth: '45%',
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
    marginLeft: 24,
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#208AEF',
  },
  errorText: {
    fontSize: 11,
    color: '#F44336',
    marginTop: 4,
    marginLeft: 24,
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
