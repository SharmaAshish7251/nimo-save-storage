import { View, StyleSheet, Text, TouchableOpacity, FlatList, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useState, useEffect } from 'react';
import { getQueue, QueueItem, addToQueue } from '@/lib/storage/queue';
import { uploadManager } from '@/lib/upload/manager';
import { scanForNewFiles } from '@/lib/scanner/files';

export default function UploadScreen() {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [scanning, setScanning] = useState(false);
  const [uploading, setUploading] = useState(false);

  const loadQueue = async () => {
    const q = await getQueue();
    setQueue(q);
  };

  useEffect(() => {
    loadQueue();
    const interval = setInterval(loadQueue, 2000);
    return () => clearInterval(interval);
  }, []);

  const scanAndQueue = async () => {
    setScanning(true);
    try {
      const newFiles = await scanForNewFiles();
      if (newFiles.length === 0) {
        Alert.alert('Info', 'No new files found');
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
      loadQueue();
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
      loadQueue();
    } catch (error: any) {
      Alert.alert('Error', error.message);
    } finally {
      setUploading(false);
    }
  };

  const clearCompleted = async () => {
    await uploadManager.clearCompleted();
    loadQueue();
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return '#4CAF50';
      case 'uploading': return '#FF9800';
      case 'failed': return '#F44336';
      case 'pending': return '#2196F3';
      default: return '#666';
    }
  };

  const renderItem = ({ item }: { item: QueueItem }) => (
    <View style={styles.queueItem}>
      <View style={styles.itemHeader}>
        <Text style={styles.fileName} numberOfLines={1}>{item.fileName}</Text>
        <Text style={[styles.status, { color: getStatusColor(item.status) }]}>
          {item.status.toUpperCase()}
        </Text>
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
        <Text style={styles.errorText} numberOfLines={2}>{item.error}</Text>
      )}
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>Upload Queue</Text>
        
        <View style={styles.buttonRow}>
          <TouchableOpacity
            style={[styles.actionButton, scanning && styles.buttonDisabled]}
            onPress={scanAndQueue}
            disabled={scanning}
          >
            <Text style={styles.actionButtonText}>
              {scanning ? 'Scanning...' : 'Scan & Add'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionButton, uploading && styles.buttonDisabled]}
            onPress={startUpload}
            disabled={uploading}
          >
            <Text style={styles.actionButtonText}>
              {uploading ? 'Uploading...' : 'Upload Now'}
            </Text>
          </TouchableOpacity>
        </View>
        
        <TouchableOpacity style={styles.clearButton} onPress={clearCompleted}>
          <Text style={styles.clearButtonText}>Clear Completed</Text>
        </TouchableOpacity>
        
        <FlatList
          data={queue}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          style={styles.list}
          ListEmptyComponent={
            <Text style={styles.emptyText}>No files in queue</Text>
          }
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  content: {
    flex: 1,
    padding: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 16,
    textAlign: 'center',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  actionButton: {
    flex: 1,
    backgroundColor: '#208AEF',
    padding: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  actionButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
  clearButton: {
    backgroundColor: '#666',
    padding: 8,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 16,
  },
  clearButtonText: {
    color: 'white',
    fontSize: 12,
  },
  list: {
    flex: 1,
  },
  queueItem: {
    backgroundColor: 'white',
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
  },
  itemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  fileName: {
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
    marginRight: 8,
  },
  status: {
    fontSize: 10,
    fontWeight: 'bold',
  },
  fileInfo: {
    fontSize: 12,
    color: '#666',
    marginBottom: 4,
  },
  progressBar: {
    height: 4,
    backgroundColor: '#e0e0e0',
    borderRadius: 2,
    overflow: 'hidden',
    marginTop: 4,
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#4CAF50',
  },
  errorText: {
    fontSize: 11,
    color: '#F44336',
    marginTop: 4,
  },
  emptyText: {
    textAlign: 'center',
    color: '#666',
    marginTop: 40,
  },
});
