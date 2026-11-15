import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { ActionHistoryItem, formatFileSize, formatDuration } from '@/lib/storage/queue';
import { getFileCategory } from '@/lib/storage/fileHelper';

function getActionColor(status: ActionHistoryItem['status']): string {
  switch (status) {
    case 'uploaded': return '#4CAF50';
    case 'failed': return '#F44336';
    case 'dismissed': return '#FF9800';
    default: return '#757575';
  }
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  const date = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return `${date} ${time}`;
}

interface UploadHistoryItemProps {
  item: ActionHistoryItem;
  resolvedDestination?: string;
  isDark: boolean;
  cardBg: string;
  borderColor: string;
  textColor: string;
  subtextColor: string;
  onPress: (item: ActionHistoryItem) => void;
  onRetryItem: (item: ActionHistoryItem) => void;
}

export const UploadHistoryItem = React.memo<UploadHistoryItemProps>(
  ({
    item,
    resolvedDestination,
    isDark,
    cardBg,
    borderColor,
    textColor,
    subtextColor,
    onPress,
    onRetryItem,
  }) => {
    const category = getFileCategory(item.fileName);

    return (
      <TouchableOpacity
        style={[styles.historyItem, { backgroundColor: cardBg, borderColor, borderWidth: isDark ? 1 : 0 }]}
        activeOpacity={0.7}
        onPress={() => onPress(item)}
      >
        <View style={styles.historyRow}>
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
          <View style={styles.historyInfo}>
            <Text style={[styles.historyFileName, { color: textColor }]} numberOfLines={1}>
              {item.fileName}
            </Text>
            <View style={styles.historyMetaRow}>
              <View style={[styles.sizePill, isDark && { backgroundColor: '#0F172A', borderColor: '#334155' }]}>
                <Text style={[styles.sizePillText, isDark && { color: '#93C5FD' }]}>
                  {formatFileSize(item.size)}
                </Text>
              </View>
              <Text style={[styles.timeMetaText, { color: subtextColor }]} numberOfLines={1}>
                {formatTimestamp(item.timestamp)}
                {item.uploadDurationMs && item.uploadDurationMs > 0
                  ? ` • ${formatDuration(item.uploadDurationMs)}`
                  : ''}
              </Text>
              {resolvedDestination ? (
                <Text style={[styles.historyDestText, isDark && { color: '#60A5FA' }]} numberOfLines={1}>
                  → {resolvedDestination}
                </Text>
              ) : null}
            </View>
          </View>
          <View style={[styles.statusTag, { backgroundColor: getActionColor(item.status) + '18' }]}>
            <Text style={[styles.statusTagText, { color: getActionColor(item.status) }]}>
              {item.status === 'uploaded' ? 'DONE' : item.status.toUpperCase()}
            </Text>
          </View>
        </View>
        {item.status === 'failed' && (
          <View style={styles.retryRow}>
            <TouchableOpacity
              style={[styles.retryButton, isDark && { backgroundColor: 'rgba(239, 68, 68, 0.15)' }]}
              onPress={(e) => {
                e.stopPropagation();
                onRetryItem(item);
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center" }}>
                <FontAwesome name="refresh" size={12} color="#DC2626" style={{ marginRight: 6 }} />
                <Text style={[styles.retryButtonText, isDark && { color: '#F87171' }]}>Retry Upload</Text>
              </View>
            </TouchableOpacity>
          </View>
        )}
      </TouchableOpacity>
    );
  },
  (prev, next) => {
    return (
      prev.item.id === next.item.id &&
      prev.item.status === next.item.status &&
      prev.item.timestamp === next.item.timestamp &&
      prev.resolvedDestination === next.resolvedDestination &&
      prev.isDark === next.isDark &&
      prev.cardBg === next.cardBg &&
      prev.borderColor === next.borderColor
    );
  }
);

UploadHistoryItem.displayName = 'UploadHistoryItem';

const styles = StyleSheet.create({
  historyItem: {
    padding: 14,
    borderRadius: 12,
    marginBottom: 8,
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  itemIconCol: {
    marginRight: 12,
    width: 24,
    alignItems: 'center',
  },
  historyInfo: {
    flex: 1,
  },
  historyFileName: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 4,
  },
  historyMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  sizePill: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  sizePillText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#3B82F6',
  },
  timeMetaText: {
    fontSize: 11,
  },
  historyDestText: {
    fontSize: 11,
    color: '#2563EB',
    maxWidth: 140,
  },
  statusTag: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    marginLeft: 8,
  },
  statusTagText: {
    fontSize: 10,
    fontWeight: '700',
  },
  retryRow: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(239, 68, 68, 0.2)',
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  retryButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#FEE2E2',
  },
  retryButtonText: {
    color: '#DC2626',
    fontSize: 12,
    fontWeight: '600',
  },
});
