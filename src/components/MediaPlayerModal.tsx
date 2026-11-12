import React, { useEffect, useState, useCallback, useRef } from 'react';
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
  ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import * as Haptics from 'expo-haptics';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import { formatFileSize } from '@/lib/storage/queue';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

const TEXT_EXTENSIONS = new Set(['txt', 'md', 'json', 'csv', 'log', 'xml', 'yml', 'yaml']);
const MAX_INLINE_TEXT_BYTES = 512 * 1024;

export interface MediaPreviewItem {
  uri: string;
  cachedLocalUri?: string;
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
  onLoadPreview?: (item: MediaPreviewItem) => Promise<string | null>;
  onOpenExternal?: (item: MediaPreviewItem) => Promise<void>;
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
  onLoadPreview,
  onOpenExternal,
  isDownloading = false,
  downloadProgress = 0,
  downloadStatusText = '',
}: MediaPlayerModalProps) {
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  const [resolvedUri, setResolvedUri] = useState<string | null>(null);
  const [textPreview, setTextPreview] = useState<string | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const retriedImageFallbackRef = useRef(false);

  const ext = item?.fileName.split('.').pop()?.toLowerCase() || '';
  const isImage = item?.category === 'image';
  const isVideo = item?.category === 'video';
  const isAudio = item?.category === 'audio';
  const isTextDoc =
    item?.category === 'document' &&
    TEXT_EXTENSIONS.has(ext) &&
    (item.size || 0) <= MAX_INLINE_TEXT_BYTES;

  const triggerPreviewLoad = useCallback(
    async (target: MediaPreviewItem) => {
      if (!onLoadPreview) return;
      setIsLoadingPreview(true);
      setPreviewError(null);
      try {
        const uri = await onLoadPreview(target);
        if (uri) {
          setResolvedUri(uri);
        } else {
          setPreviewError('Preview is not available.');
        }
      } catch (err: any) {
        setPreviewError(err?.message || 'Failed to load preview from Telegram cloud.');
      } finally {
        setIsLoadingPreview(false);
      }
    },
    [onLoadPreview]
  );

  useEffect(() => {
    retriedImageFallbackRef.current = false;
    setTextPreview(null);
    setPreviewError(null);

    if (!visible || !item) {
      setResolvedUri(null);
      setIsLoadingPreview(false);
      return;
    }

    const initialUri =
      item.cachedLocalUri ||
      (item.existsLocally && !item.uri.startsWith('tg://') ? item.uri : null);
    setResolvedUri(initialUri);

    if (!initialUri && (isImage || isTextDoc) && onLoadPreview && item.cloudStatus !== 'missing') {
      void triggerPreviewLoad(item);
    }
  }, [visible, item, isImage, isTextDoc, onLoadPreview, triggerPreviewLoad]);

  useEffect(() => {
    let cancelled = false;
    if (!visible || !isTextDoc || !resolvedUri || !resolvedUri.startsWith('file://')) {
      return;
    }

    LegacyFileSystem.readAsStringAsync(resolvedUri)
      .then((content) => {
        if (!cancelled) setTextPreview(content);
      })
      .catch(() => {
        if (!cancelled) setTextPreview(null);
      });

    return () => {
      cancelled = true;
    };
  }, [visible, isTextDoc, resolvedUri]);

  if (!item) return null;

  const bg = isDark ? '#0B0F19' : '#0F172A';
  const cardBg = '#1E293B';
  const textPrimary = '#F8FAFC';
  const textSecondary = '#94A3B8';
  const isMediaVisual = isImage || isVideo;
  const saveLabel = isMediaVisual ? 'Save to Gallery' : 'Save File';
  const canOpenExternal = Boolean(onOpenExternal || onShare);

  const handleImageError = () => {
    if (!retriedImageFallbackRef.current && onLoadPreview) {
      retriedImageFallbackRef.current = true;
      void triggerPreviewLoad(item);
    } else {
      setPreviewError('Could not render image preview.');
    }
  };

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
            <Text style={[styles.subText, { color: textSecondary }]} numberOfLines={1}>
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
              disabled={isDownloading || isLoadingPreview}
            >
              <FontAwesome name="share" size={16} color="#38BDF8" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Center Media Canvas */}
        <View style={styles.mediaContainer}>
          {isImage && resolvedUri ? (
            <Image
              source={{ uri: resolvedUri }}
              style={styles.fullImage}
              resizeMode="contain"
              onError={handleImageError}
            />
          ) : isTextDoc && textPreview !== null ? (
            <ScrollView
              style={styles.textPreviewScroll}
              contentContainerStyle={styles.textPreviewContent}
            >
              <Text style={styles.textPreviewCode}>{textPreview}</Text>
            </ScrollView>
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
                {isLoadingPreview ? (
                  <ActivityIndicator size="large" color="#38BDF8" />
                ) : (
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
                    size={54}
                    color={isVideo ? '#A78BFA' : isAudio ? '#F472B6' : '#38BDF8'}
                  />
                )}
              </View>

              <Text style={styles.canvasTitle} numberOfLines={2}>
                {item.fileName}
              </Text>
              <Text style={styles.canvasSub}>
                {isLoadingPreview
                  ? 'Fetching preview from Telegram Cloud...'
                  : previewError
                  ? previewError
                  : resolvedUri || item.existsLocally
                  ? 'Ready to open or play with a device app'
                  : 'Stored in Telegram Cloud — open or download anytime'}
              </Text>

              {/* Telegram cloud badge */}
              <View style={styles.telegramPill}>
                <FontAwesome name="telegram" size={12} color="#38BDF8" style={{ marginRight: 6 }} />
                <Text style={styles.telegramPillText}>
                  {item.telegramMessageId ? `Cloud ID #${item.telegramMessageId}` : 'Telegram Cloud'}
                </Text>
              </View>

              {/* Action button inside canvas for non-inline media / retry */}
              {!isLoadingPreview && (isVideo || isAudio || !isImage) && canOpenExternal && (
                <TouchableOpacity
                  style={styles.openExternalBtn}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                    if (onOpenExternal) {
                      void onOpenExternal(item);
                    } else {
                      onShare(item);
                    }
                  }}
                  disabled={isDownloading}
                >
                  <FontAwesome
                    name={isVideo || isAudio ? 'play-circle' : 'external-link'}
                    size={16}
                    color="#FFFFFF"
                    style={{ marginRight: 8 }}
                  />
                  <Text style={styles.openExternalBtnText}>
                    {isVideo
                      ? 'Play Video in Player'
                      : isAudio
                      ? 'Play Audio in Player'
                      : 'Open in Device App'}
                  </Text>
                </TouchableOpacity>
              )}

              {!isLoadingPreview && previewError && isImage && onLoadPreview && (
                <TouchableOpacity
                  style={styles.openExternalBtn}
                  onPress={() => void triggerPreviewLoad(item)}
                >
                  <FontAwesome name="refresh" size={14} color="#FFFFFF" style={{ marginRight: 8 }} />
                  <Text style={styles.openExternalBtnText}>Retry Preview</Text>
                </TouchableOpacity>
              )}
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
        <View
          style={[
            styles.bottomBar,
            { backgroundColor: cardBg, paddingBottom: Math.max(insets.bottom, 16) + 8 },
          ]}
        >
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
              name={isMediaVisual ? 'photo' : 'download'}
              size={15}
              color="#FFFFFF"
              style={{ marginRight: 8 }}
            />
            <Text style={styles.actionBtnText} numberOfLines={1}>
              {saveLabel}
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
            <Text style={[styles.actionBtnText, { color: '#38BDF8' }]} numberOfLines={1}>
              Share
            </Text>
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
  textPreviewScroll: {
    flex: 1,
    width: '100%',
  },
  textPreviewContent: {
    padding: 18,
  },
  textPreviewCode: {
    color: '#E2E8F0',
    fontSize: 13,
    lineHeight: 20,
  },
  openExternalBtn: {
    marginTop: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#208AEF',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
  },
  openExternalBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
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
