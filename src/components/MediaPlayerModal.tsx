import React from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  Dimensions,
  useColorScheme,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import * as Haptics from 'expo-haptics';
import { formatFileSize } from '@/lib/storage/queue';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

export interface MediaPreviewItem {
  uri: string;
  fileName: string;
  size: number;
  category: 'image' | 'video' | 'audio' | 'document' | string;
  existsLocally?: boolean;
  uploadedAt: number;
  telegramMessageId?: number;
  cloudStatus?: 'active' | 'missing' | string;
}

interface MediaPlayerModalProps {
  visible: boolean;
  item: MediaPreviewItem | null;
  onClose: () => void;
  onShare: (item: MediaPreviewItem) => void;
  onDownload: (item: MediaPreviewItem) => void;
  isDownloading?: boolean;
  downloadProgress?: number;
  downloadStatusText?: string;
}

export function MediaPlayerModal({
  visible,
  item,
  onClose,
  onShare,
  onDownload,
  isDownloading = false,
  downloadProgress = 0,
  downloadStatusText = '',
}: MediaPlayerModalProps) {
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  if (!item) return null;

  const isImage = item.category === 'image';
  const isVideo = item.category === 'video';
  const isAudio = item.category === 'audio';

  const bg = isDark ? '#0B0F19' : '#0F172A';
  const cardBg = isDark ? '#1E293B' : '#1E293B';
  const textPrimary = '#F8FAFC';
  const textSecondary = '#94A3B8';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={[styles.overlay, { backgroundColor: bg }]}>
        {/* Top App Bar */}
        <View style={[styles.topBar, { paddingTop: Math.max(insets.top, 16) + 8 }]}>
          <TouchableOpacity
            style={styles.navBtn}
            onPress={() => {
              Haptics.selectionAsync().catch(() => {});
              onClose();
            }}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <FontAwesome name="arrow-left" size={16} color={textPrimary} />
          </TouchableOpacity>

          <View style={styles.topInfoWrap}>
            <Text style={[styles.titleText, { color: textPrimary }]} numberOfLines={1}>
              {item.fileName}
            </Text>
            <Text style={[styles.subText, { color: textSecondary }]}>
              {formatFileSize(item.size)} • {new Date(item.uploadedAt).toLocaleDateString()}
            </Text>
          </View>

          <View style={styles.topRightActions}>
            <TouchableOpacity
              style={styles.navBtn}
              onPress={() => {
                Haptics.selectionAsync().catch(() => {});
                onShare(item);
              }}
              disabled={isDownloading}
            >
              <FontAwesome name="share" size={16} color="#38BDF8" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Center Media Canvas */}
        <View style={styles.mediaContainer}>
          {isImage && item.existsLocally && !item.uri.startsWith('tg://') ? (
            <Image
              source={{ uri: item.uri }}
              style={styles.fullImage}
              resizeMode="contain"
            />
          ) : (
            <View style={styles.placeholderCanvas}>
              <View
                style={[
                  styles.iconHalo,
                  {
                    backgroundColor: isVideo
                      ? 'rgba(139, 92, 246, 0.15)'
                      : isAudio
                      ? 'rgba(236, 72, 153, 0.15)'
                      : 'rgba(56, 189, 248, 0.15)',
                  },
                ]}
              >
                <FontAwesome
                  name={
                    isVideo
                      ? 'file-video-o'
                      : isAudio
                      ? 'file-audio-o'
                      : isImage
                      ? 'file-image-o'
                      : 'file-text-o'
                  }
                  size={56}
                  color={isVideo ? '#A78BFA' : isAudio ? '#F472B6' : '#38BDF8'}
                />
              </View>

              <Text style={styles.canvasTitle}>{item.fileName}</Text>
              <Text style={styles.canvasSub}>
                {item.existsLocally
                  ? 'Saved on Device'
                  : 'Preserved Bit-for-Bit in Telegram Cloud'}
              </Text>

              {/* Telegram cloud badge */}
              <View style={styles.telegramPill}>
                <FontAwesome name="telegram" size={12} color="#38BDF8" style={{ marginRight: 6 }} />
                <Text style={styles.telegramPillText}>
                  {item.telegramMessageId ? `Cloud ID #${item.telegramMessageId}` : 'Telegram Cloud'}
                </Text>
              </View>
            </View>
          )}

          {/* Download progress overlay if downloading */}
          {isDownloading && (
            <View style={styles.downloadProgressOverlay}>
              <View style={styles.downloadCard}>
                <ActivityIndicator size="large" color="#38BDF8" style={{ marginBottom: 12 }} />
                <Text style={styles.downloadTitleText}>Downloading from Cloud</Text>
                <Text style={styles.downloadSubText}>{downloadStatusText || 'Fetching media file...'}</Text>
                <View style={styles.progressBarTrack}>
                  <View
                    style={[
                      styles.progressBarFill,
                      { width: `${Math.round(downloadProgress * 100)}%` },
                    ]}
                  />
                </View>
                <Text style={styles.progressPercentText}>{Math.round(downloadProgress * 100)}%</Text>
              </View>
            </View>
          )}
        </View>

        {/* Bottom Control Bar */}
        <View style={[styles.bottomBar, { backgroundColor: cardBg }]}>
          <TouchableOpacity
            style={[
              styles.actionBtn,
              styles.downloadBtn,
              isDownloading && styles.actionBtnDisabled,
            ]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
              onDownload(item);
            }}
            disabled={isDownloading}
            activeOpacity={0.8}
          >
            <FontAwesome
              name={item.existsLocally ? 'check-circle' : 'download'}
              size={15}
              color="#FFFFFF"
              style={{ marginRight: 8 }}
            />
            <Text style={styles.actionBtnText}>
              {item.existsLocally ? 'Re-Download / Save to Gallery' : 'Download to Device'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.actionBtn,
              styles.shareBtn,
              isDownloading && styles.actionBtnDisabled,
            ]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
              onShare(item);
            }}
            disabled={isDownloading}
            activeOpacity={0.8}
          >
            <FontAwesome name="share" size={14} color="#38BDF8" style={{ marginRight: 8 }} />
            <Text style={[styles.actionBtnText, { color: '#38BDF8' }]}>Share</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 48,
    paddingBottom: 14,
    backgroundColor: 'rgba(15, 23, 42, 0.95)',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#334155',
  },
  navBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  topInfoWrap: {
    flex: 1,
    marginHorizontal: 12,
  },
  titleText: {
    fontSize: 15,
    fontWeight: '700',
  },
  subText: {
    fontSize: 11,
    marginTop: 2,
  },
  topRightActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  mediaContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  fullImage: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT - 180,
  },
  placeholderCanvas: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  iconHalo: {
    width: 120,
    height: 120,
    borderRadius: 60,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  canvasTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#F8FAFC',
    textAlign: 'center',
    marginBottom: 6,
  },
  canvasSub: {
    fontSize: 13,
    color: '#94A3B8',
    textAlign: 'center',
    marginBottom: 16,
  },
  telegramPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(56, 189, 248, 0.12)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.25)',
  },
  telegramPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#38BDF8',
  },
  downloadProgressOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  downloadCard: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 320,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  downloadTitleText: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
  },
  downloadSubText: {
    color: '#94A3B8',
    fontSize: 12,
    marginBottom: 16,
    textAlign: 'center',
  },
  progressBarTrack: {
    width: '100%',
    height: 6,
    backgroundColor: '#0F172A',
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 8,
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#38BDF8',
    borderRadius: 3,
  },
  progressPercentText: {
    color: '#38BDF8',
    fontSize: 12,
    fontWeight: '700',
  },
  bottomBar: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    paddingBottom: 28,
    flexDirection: 'row',
    gap: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#334155',
  },
  actionBtn: {
    flex: 1,
    height: 48,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  downloadBtn: {
    backgroundColor: '#208AEF',
    flex: 1.5,
  },
  shareBtn: {
    backgroundColor: 'rgba(56, 189, 248, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.3)',
  },
  actionBtnDisabled: {
    opacity: 0.5,
  },
  actionBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
});
