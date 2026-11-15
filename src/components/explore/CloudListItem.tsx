import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
} from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { formatFileSize } from '@/lib/storage/queue';
import type { CloudItem } from './types';

function getCategoryIcon(category: string): string {
  switch (category) {
    case 'image': return 'image';
    case 'video': return 'video-camera';
    case 'audio': return 'music';
    case 'document': return 'file-text';
    default: return 'file';
  }
}

interface CloudListItemProps {
  item: CloudItem;
  isSelected: boolean;
  isSelectMode: boolean;
  isDark: boolean;
  cardBg: string;
  border: string;
  textColor: string;
  subtextColor: string;
  onPress: (item: CloudItem) => void;
  onLongPress: (item: CloudItem) => void;
}

export const CloudListItem = React.memo<CloudListItemProps>(
  ({
    item,
    isSelected,
    isSelectMode,
    isDark,
    cardBg,
    border,
    textColor,
    subtextColor,
    onPress,
    onLongPress,
  }) => {
    const isImage = item.category === 'image';

    return (
      <TouchableOpacity
        style={[
          styles.listRow,
          { backgroundColor: cardBg, borderColor: border },
          isSelected && styles.listRowSelected,
        ]}
        onPress={() => onPress(item)}
        onLongPress={() => onLongPress(item)}
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
      </TouchableOpacity>
    );
  },
  (prev, next) => {
    return (
      prev.isSelected === next.isSelected &&
      prev.isSelectMode === next.isSelectMode &&
      prev.isDark === next.isDark &&
      prev.cardBg === next.cardBg &&
      prev.border === next.border &&
      prev.textColor === next.textColor &&
      prev.subtextColor === next.subtextColor &&
      prev.item.uri === next.item.uri &&
      prev.item.cloudStatus === next.item.cloudStatus &&
      prev.item.existsLocally === next.item.existsLocally
    );
  }
);

CloudListItem.displayName = 'CloudListItem';

const styles = StyleSheet.create({
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
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
  destBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
    borderWidth: 1,
  },
  destBadgeText: {
    fontSize: 10,
    fontWeight: '600',
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
});
