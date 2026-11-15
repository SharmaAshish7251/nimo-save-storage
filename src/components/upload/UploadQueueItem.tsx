import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { QueueItem, formatFileSize, formatDuration, formatSpeed } from '@/lib/storage/queue';
import { getFileCategory } from '@/lib/storage/fileHelper';

function getStatusColor(status: QueueItem['status']): string {
  switch (status) {
    case 'completed': return '#4CAF50';
    case 'uploading': return '#208AEF';
    case 'failed': return '#F44336';
    case 'paused': return '#FF9800';
    default: return '#757575';
  }
}

interface UploadQueueItemProps {
  item: QueueItem;
  destinationTitle: string;
  isCurrentlyUploading: boolean;
  isDark: boolean;
  cardBg: string;
  borderColor: string;
  textColor: string;
  subtextColor: string;
  onPress: (item: QueueItem) => void;
  onUploadSingle: (item: QueueItem) => void;
  onPauseItem: (item: QueueItem) => void;
  onResumeItem: (item: QueueItem) => void;
  onRetryItem: (item: QueueItem) => void;
  onDiscardItem: (item: QueueItem) => void;
}

export const UploadQueueItem = React.memo<UploadQueueItemProps>(
  ({
    item,
    destinationTitle,
    isCurrentlyUploading,
    isDark,
    cardBg,
    borderColor,
    textColor,
    subtextColor,
    onPress,
    onUploadSingle,
    onPauseItem,
    onResumeItem,
    onRetryItem,
    onDiscardItem,
  }) => {
    const category = getFileCategory(item.fileName, item.mimeType);

    return (
      <TouchableOpacity
        style={[styles.item, { backgroundColor: cardBg, borderColor, borderWidth: isDark ? 1 : 0 }]}
        activeOpacity={0.7}
        onPress={() => onPress(item)}
      >
        <View style={styles.itemHeader}>
          <View style={styles.itemIconCol}>
            {category === 'image' ? (
              <FontAwesome name="picture-o" size={18} color="#208AEF" />
            ) : category === 'video' ? (
              <FontAwesome name="video-camera" size={18} color="#8B5CF6" />
            ) : category === 'audio' ? (
              <FontAwesome name="music" size={18} color="#EC4899" />
            ) : (
              <FontAwesome name="file-text-o" size={18} color="#10B981" />
            )}
          </View>
          <View style={styles.itemInfo}>
            <Text style={[styles.fileName, { color: textColor }]} numberOfLines={1}>
              {item.fileName}
            </Text>
            <View style={styles.metaRow}>
              <Text style={[styles.metaText, { color: subtextColor }]}>
                {formatFileSize(item.size)}
              </Text>
              {item.status === 'uploading' && (
                <>
                  <Text style={styles.metaProgressText}>• {item.progress}%</Text>
                  {typeof item.speedKbps === 'number' && item.speedKbps > 0 ? (
                    <Text style={[styles.metaProgressText, { color: '#0284C7', fontWeight: '600' }]}>
                      • {formatSpeed(item.speedKbps * 1024)}
                    </Text>
                  ) : (
                    <Text style={[styles.metaProgressText, { color: '#64748B' }]}>• Connecting…</Text>
                  )}
                  {typeof item.speedKbps === 'number' && item.speedKbps > 0 && item.size > 0 ? (
                    <Text style={[styles.metaProgressText, { color: '#10B981', fontWeight: '600' }]}>
                      • ~{Math.max(1, Math.round(((item.size * (1 - (item.progress || 0) / 100)) / 1024) / item.speedKbps)) < 60
                        ? `${Math.max(1, Math.round(((item.size * (1 - (item.progress || 0) / 100)) / 1024) / item.speedKbps))}s left`
                        : `${Math.ceil(Math.max(1, Math.round(((item.size * (1 - (item.progress || 0) / 100)) / 1024) / item.speedKbps)) / 60)}m left`}
                    </Text>
                  ) : null}
                </>
              )}
              {item.uploadDurationMs && item.uploadDurationMs > 0 && item.status === 'completed' && (
                <Text style={styles.metaDurationText}>
                  • {formatDuration(item.uploadDurationMs)}
                </Text>
              )}
              <Text style={[styles.queueDestText, isDark && { color: '#60A5FA' }]} numberOfLines={1}>
                • → {destinationTitle}
              </Text>
            </View>
          </View>
          <View style={styles.itemStatusRight}>
            <View style={[styles.statusBadge, { backgroundColor: getStatusColor(item.status) + '15' }]}>
              <Text style={[styles.statusText, { color: getStatusColor(item.status) }]}>
                {item.status.toUpperCase()}
              </Text>
              {item.status === 'failed' && typeof item.retries === 'number' && item.retries > 0 && (
                <Text style={{ color: '#F87171', fontSize: 9, fontWeight: '700', marginTop: 1 }}>
                  {item.retries}× tried
                </Text>
              )}
            </View>
            {(item.status === 'pending' || (item.status === 'uploading' && !isCurrentlyUploading)) && (
              <TouchableOpacity
                style={[styles.itemUploadBtn, isDark && { backgroundColor: 'rgba(32, 138, 239, 0.15)' }]}
                onPress={(e) => {
                  e.stopPropagation();
                  onUploadSingle(item);
                }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <FontAwesome name="rocket" size={13} color="#208AEF" />
              </TouchableOpacity>
            )}
            {item.status === 'uploading' && isCurrentlyUploading && (
              <TouchableOpacity
                style={[styles.itemUploadBtn, { backgroundColor: isDark ? 'rgba(217, 119, 6, 0.2)' : '#FEF3C7' }]}
                onPress={(e) => {
                  e.stopPropagation();
                  onPauseItem(item);
                }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <FontAwesome name="pause" size={12} color="#D97706" />
              </TouchableOpacity>
            )}
            {item.status === 'paused' && (
              <TouchableOpacity
                style={[styles.itemUploadBtn, { backgroundColor: isDark ? 'rgba(22, 163, 74, 0.2)' : '#DCFCE7' }]}
                onPress={(e) => {
                  e.stopPropagation();
                  onResumeItem(item);
                }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <FontAwesome name="play" size={12} color="#16A34A" />
              </TouchableOpacity>
            )}
            {item.status === 'failed' && (
              <TouchableOpacity
                style={[styles.itemUploadBtn, { backgroundColor: isDark ? 'rgba(220, 38, 38, 0.2)' : '#FEE2E2' }]}
                onPress={(e) => {
                  e.stopPropagation();
                  onRetryItem(item);
                }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <FontAwesome name="refresh" size={13} color="#DC2626" />
              </TouchableOpacity>
            )}
            {item.status !== 'completed' && (
              <TouchableOpacity
                style={styles.discardButton}
                onPress={(e) => {
                  e.stopPropagation();
                  onDiscardItem(item);
                }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <FontAwesome name="times" size={13} color={isDark ? "#94A3B8" : "#9CA3AF"} />
              </TouchableOpacity>
            )}
          </View>
        </View>
        {item.status === 'uploading' && (
          <View style={[styles.progressBar, isDark && { backgroundColor: '#334155' }]}>
            <View style={[styles.progressFill, { width: `${item.progress}%` }]} />
          </View>
        )}
        {item.error && <Text style={styles.errorText} numberOfLines={2}>{item.error}</Text>}
      </TouchableOpacity>
    );
  },
  (prev, next) => {
    return (
      prev.item.id === next.item.id &&
      prev.item.status === next.item.status &&
      prev.item.progress === next.item.progress &&
      prev.item.speedKbps === next.item.speedKbps &&
      prev.item.error === next.item.error &&
      prev.destinationTitle === next.destinationTitle &&
      prev.isCurrentlyUploading === next.isCurrentlyUploading &&
      prev.isDark === next.isDark &&
      prev.cardBg === next.cardBg &&
      prev.borderColor === next.borderColor
    );
  }
);

UploadQueueItem.displayName = 'UploadQueueItem';

const styles = StyleSheet.create({
  item: {
    padding: 14,
    borderRadius: 12,
    marginBottom: 8,
  },
  itemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  itemIconCol: {
    marginRight: 12,
    width: 24,
    alignItems: 'center',
  },
  itemInfo: {
    flex: 1,
  },
  fileName: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 4,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 4,
  },
  metaText: {
    fontSize: 12,
  },
  metaProgressText: {
    fontSize: 12,
    color: '#208AEF',
  },
  metaDurationText: {
    fontSize: 12,
    color: '#10B981',
  },
  queueDestText: {
    fontSize: 11,
    color: '#3B82F6',
    maxWidth: 150,
  },
  itemStatusRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginLeft: 8,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    alignItems: 'center',
  },
  statusText: {
    fontSize: 10,
    fontWeight: '700',
  },
  itemUploadBtn: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  discardButton: {
    width: 28,
    height: 28,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressBar: {
    height: 4,
    backgroundColor: '#E2E8F0',
    borderRadius: 2,
    marginTop: 10,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#208AEF',
    borderRadius: 2,
  },
  errorText: {
    color: '#EF4444',
    fontSize: 11,
    marginTop: 6,
  },
});
