import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  Dimensions,
} from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { formatFileSize } from '@/lib/storage/queue';
import type { CloudItem } from './types';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const GRID_COLUMNS = 3;
const GRID_ITEM_SIZE = (SCREEN_WIDTH - 32 - (GRID_COLUMNS - 1) * 8) / GRID_COLUMNS;

function getCategoryIcon(category: string): string {
  switch (category) {
    case 'image': return 'image';
    case 'video': return 'video-camera';
    case 'audio': return 'music';
    case 'document': return 'file-text';
    default: return 'file';
  }
}

interface CloudGridItemProps {
  item: CloudItem;
  isSelected: boolean;
  isSelectMode: boolean;
  isDark: boolean;
  cardBg: string;
  border: string;
  subtextColor: string;
  onPress: (item: CloudItem) => void;
  onLongPress: (item: CloudItem) => void;
}

export const CloudGridItem = React.memo<CloudGridItemProps>(
  ({
    item,
    isSelected,
    isSelectMode,
    isDark,
    cardBg,
    border,
    subtextColor,
    onPress,
    onLongPress,
  }) => {
    const isImage = item.category === 'image';

    return (
      <TouchableOpacity
        style={[
          styles.gridCell,
          { backgroundColor: cardBg, borderColor: border },
          isSelected && styles.gridCellSelected,
        ]}
        onPress={() => onPress(item)}
        onLongPress={() => onLongPress(item)}
        delayLongPress={300}
        activeOpacity={0.8}
      >
        {isImage && (item.existsLocally || item.cachedLocalUri) ? (
          <Image
            source={{ uri: item.cachedLocalUri || item.uri }}
            style={styles.gridThumbImage}
            resizeMode="cover"
          />
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
          <Text style={styles.gridSizeText}>
            {formatFileSize(item.chunkManifest ? item.chunkManifest.originalSize : item.size)}
          </Text>
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
  },
  (prev, next) => {
    return (
      prev.isSelected === next.isSelected &&
      prev.isSelectMode === next.isSelectMode &&
      prev.isDark === next.isDark &&
      prev.cardBg === next.cardBg &&
      prev.border === next.border &&
      prev.item.uri === next.item.uri &&
      prev.item.cloudStatus === next.item.cloudStatus &&
      prev.item.existsLocally === next.item.existsLocally &&
      prev.item.cachedLocalUri === next.item.cachedLocalUri
    );
  }
);

CloudGridItem.displayName = 'CloudGridItem';

const styles = StyleSheet.create({
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
  gridCellSelected: {
    borderColor: '#208AEF',
    borderWidth: 2,
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
});
