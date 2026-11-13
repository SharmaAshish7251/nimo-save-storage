import React, { useState, useEffect, useMemo } from 'react';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import {
  formatFileSize,
  formatDuration,
  formatSpeed,
  getConfig,
  resolveFileDestination,
  AppConfig,
} from '@/lib/storage/queue';
import { getFileCategory } from '@/lib/scanner/files';
import { useAppTheme } from '@/context/ThemeContext';

export interface FileDetailData {
  id?: string;
  fileName: string;
  uri: string;
  size: number;
  mimeType?: string;
  status?:
    | 'pending'
    | 'uploading'
    | 'completed'
    | 'failed'
    | 'paused'
    | 'uploaded'
    | 'dismissed'
    | string;
  progress?: number;
  retries?: number;
  addedAt?: number;
  timestamp?: number;
  uploadStartedAt?: number;
  uploadedAt?: number;
  uploadDurationMs?: number;
  destination?: string;
  error?: string;
  isHistory?: boolean;
}

interface Props {
  visible: boolean;
  file: FileDetailData | null;
  config?: AppConfig | null;
  onClose: () => void;
  onDiscard?: (file: FileDetailData) => void;
  onRetry?: (file: FileDetailData) => void;
  onUploadNow?: (file: FileDetailData) => void;
  onPause?: (file: FileDetailData) => void;
  onResume?: (file: FileDetailData) => void;
}

export function FileDetailsModal({
  visible,
  file,
  config,
  onClose,
  onDiscard,
  onRetry,
  onUploadNow,
  onPause,
  onResume,
}: Props) {
  const { isDark } = useAppTheme();
  const [appConfig, setAppConfig] = useState<AppConfig | null>(config || null);

  useEffect(() => {
    if (!config) {
      getConfig().then(setAppConfig).catch(() => {});
    } else {
      setAppConfig(config);
    }
  }, [config]);

  const resolvedDestination = useMemo(() => {
    if (
      file?.destination &&
      file.destination !== 'Saved Messages (Default)' &&
      file.destination !== 'Saved Messages'
    ) {
      return file.destination;
    }
    if (!file) return 'Saved Messages';
    const res = resolveFileDestination(file.fileName, file.mimeType, appConfig);
    return res.destinationTitle;
  }, [file, appConfig]);

  if (!file) return null;

  const category = getFileCategory(file.fileName, file.mimeType);

  const getCategoryIcon = (cat: string, size = 20) => {
    switch (cat) {
      case 'image':
        return <FontAwesome name="picture-o" size={size} color="#208AEF" />;
      case 'video':
        return <FontAwesome name="video-camera" size={size} color="#8B5CF6" />;
      case 'audio':
        return <FontAwesome name="music" size={size} color="#EC4899" />;
      case 'document':
        return <FontAwesome name="file-text-o" size={size} color="#10B981" />;
      default:
        return <FontAwesome name="file-o" size={size} color="#6B7280" />;
    }
  };

  const getStatusColor = (status?: string) => {
    switch (status) {
      case 'completed':
      case 'uploaded':
        return '#10B981';
      case 'uploading':
        return '#F59E0B';
      case 'paused':
        return '#EAB308';
      case 'failed':
        return '#EF4444';
      case 'pending':
        return '#2563EB';
      case 'dismissed':
        return '#64748B';
      default:
        return '#64748B';
    }
  };

  const formatTimestamp = (ts?: number) => {
    if (!ts) return '—';
    const d = new Date(ts);
    const timeStr = d.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    const today = new Date();
    const isToday =
      d.getDate() === today.getDate() &&
      d.getMonth() === today.getMonth() &&
      d.getFullYear() === today.getFullYear();

    if (isToday) {
      return `Today at ${timeStr}`;
    }
    return `${d.toLocaleDateString([], {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })} at ${timeStr}`;
  };

  const statusColor = getStatusColor(file.status);
  const statusLabel = file.status ? file.status.toUpperCase() : 'PENDING';

  // Theme-aware tokens
  const cardBg = isDark ? '#1E293B' : '#FFFFFF';
  const headerBg = isDark ? '#0F172A' : '#F8FAFC';
  const border = isDark ? '#334155' : '#E2E8F0';
  const sectionBg = isDark ? '#0F172A' : '#F8FAFC';
  const textPrimary = isDark ? '#F8FAFC' : '#0F172A';
  const textSecondary = isDark ? '#94A3B8' : '#64748B';
  const closeBtnBg = isDark ? '#334155' : '#E2E8F0';
  const rowBorder = isDark ? '#1E293B' : '#F1F5F9';
  const footerBg = isDark ? '#0F172A' : '#FAF5FF';

  const hasPrimaryActions =
    !file.isHistory &&
    (file.status === 'pending' ||
      file.status === 'uploading' ||
      file.status === 'paused' ||
      file.status === 'failed');

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent={true}
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <View
          style={[
            styles.modalCard,
            { backgroundColor: cardBg, borderColor: border },
          ]}
        >
          {/* Header */}
          <View
            style={[
              styles.header,
              { backgroundColor: headerBg, borderBottomColor: border },
            ]}
          >
            <View style={styles.headerLeft}>
              <View
                style={[
                  styles.fileIconContainer,
                  {
                    backgroundColor: isDark ? '#1E293B' : '#EEF2FF',
                    borderColor: border,
                  },
                ]}
              >
                {getCategoryIcon(category, 20)}
              </View>
              <View style={styles.headerTextContainer}>
                <Text
                  style={[styles.headerTitle, { color: textPrimary }]}
                  numberOfLines={1}
                >
                  {file.fileName}
                </Text>
                <View
                  style={[
                    styles.statusBadge,
                    { backgroundColor: statusColor + '20' },
                  ]}
                >
                  <Text style={[styles.statusBadgeText, { color: statusColor }]}>
                    ● {statusLabel}
                  </Text>
                </View>
              </View>
            </View>
            <TouchableOpacity
              onPress={onClose}
              style={[styles.closeBtn, { backgroundColor: closeBtnBg }]}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <FontAwesome name="times" size={15} color={textSecondary} />
            </TouchableOpacity>
          </View>

          {/* Details Scroll Area */}
          <ScrollView
            style={styles.body}
            contentContainerStyle={{ paddingBottom: 16 }}
            showsVerticalScrollIndicator={false}
          >
            {/* File Info Section */}
            <View
              style={[
                styles.section,
                { backgroundColor: sectionBg, borderColor: border },
              ]}
            >
              <Text style={[styles.sectionTitle, { color: textSecondary }]}>
                File Information
              </Text>

              {/* Full Name Block */}
              <View style={[styles.detailBlock, { borderBottomColor: rowBorder }]}>
                <Text style={[styles.detailLabel, { color: textSecondary }]}>
                  Full Name
                </Text>
                <Text
                  style={[
                    styles.fileNameBox,
                    {
                      color: textPrimary,
                      backgroundColor: isDark ? '#1E293B' : '#FFFFFF',
                      borderColor: border,
                    },
                  ]}
                  selectable={true}
                  numberOfLines={3}
                >
                  {file.fileName}
                </Text>
              </View>

              <View style={[styles.detailRow, { borderBottomColor: rowBorder }]}>
                <Text style={[styles.detailLabel, { color: textSecondary }]}>
                  Total Size
                </Text>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={[styles.detailValue, styles.sizeHighlight]}>
                    {formatFileSize(file.size)}
                  </Text>
                  <Text style={[styles.detailSubValue, { color: textSecondary }]}>
                    {file.size?.toLocaleString()} bytes
                  </Text>
                </View>
              </View>

              <View style={[styles.detailRow, { borderBottomColor: rowBorder }]}>
                <Text style={[styles.detailLabel, { color: textSecondary }]}>
                  Category
                </Text>
                <Text style={[styles.detailValue, { color: textPrimary }]}>
                  {category.charAt(0).toUpperCase() + category.slice(1)}{' '}
                  {file.mimeType ? `(${file.mimeType})` : ''}
                </Text>
              </View>

              {/* File Path Block */}
              <View style={styles.detailBlock}>
                <Text style={[styles.detailLabel, { color: textSecondary }]}>
                  File Path
                </Text>
                <Text
                  style={[
                    styles.uriBox,
                    {
                      color: textSecondary,
                      backgroundColor: isDark ? '#1E293B' : '#FFFFFF',
                      borderColor: border,
                    },
                  ]}
                  numberOfLines={3}
                  selectable={true}
                >
                  {file.uri}
                </Text>
              </View>
            </View>

            {/* Upload Details Section */}
            <View
              style={[
                styles.section,
                { backgroundColor: sectionBg, borderColor: border },
              ]}
            >
              <Text style={[styles.sectionTitle, { color: textSecondary }]}>
                Upload Details
              </Text>

              <View style={[styles.detailRow, { borderBottomColor: rowBorder }]}>
                <Text style={[styles.detailLabel, { color: textSecondary }]}>
                  Destination
                </Text>
                <View style={{ flex: 1, alignItems: 'flex-end' }}>
                  <Text
                    style={[styles.detailValue, styles.destHighlight]}
                    numberOfLines={1}
                  >
                    {resolvedDestination}
                  </Text>
                  {appConfig?.multiChannelRouting && (
                    <View
                      style={[
                        styles.streamPill,
                        {
                          backgroundColor: isDark ? '#1E3A8A' : '#EFF6FF',
                          borderColor: isDark ? '#3B82F6' : '#BFDBFE',
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.streamPillText,
                          { color: isDark ? '#93C5FD' : '#2563EB' },
                        ]}
                      >
                        ● Multi-Stream Active
                      </Text>
                    </View>
                  )}
                </View>
              </View>

              {file.addedAt && (
                <View style={[styles.detailRow, { borderBottomColor: rowBorder }]}>
                  <Text style={[styles.detailLabel, { color: textSecondary }]}>
                    Added to Queue
                  </Text>
                  <Text style={[styles.detailValue, { color: textPrimary }]}>
                    {formatTimestamp(file.addedAt)}
                  </Text>
                </View>
              )}

              {file.uploadStartedAt && (
                <View style={[styles.detailRow, { borderBottomColor: rowBorder }]}>
                  <Text style={[styles.detailLabel, { color: textSecondary }]}>
                    Upload Started
                  </Text>
                  <Text style={[styles.detailValue, { color: textPrimary }]}>
                    {formatTimestamp(file.uploadStartedAt)}
                  </Text>
                </View>
              )}

              {(file.uploadedAt || (file.status === 'uploaded' && file.timestamp)) && (
                <View style={[styles.detailRow, { borderBottomColor: rowBorder }]}>
                  <Text style={[styles.detailLabel, { color: textSecondary }]}>
                    Uploaded At
                  </Text>
                  <Text
                    style={[
                      styles.detailValue,
                      { color: '#10B981', fontWeight: 'bold' },
                    ]}
                  >
                    {formatTimestamp(file.uploadedAt || file.timestamp)}
                  </Text>
                </View>
              )}

              {file.uploadDurationMs && file.uploadDurationMs > 0 && (
                <>
                  <View
                    style={[styles.detailRow, { borderBottomColor: rowBorder }]}
                  >
                    <Text style={[styles.detailLabel, { color: textSecondary }]}>
                      Upload Duration
                    </Text>
                    <Text
                      style={[styles.detailValue, styles.durationHighlight]}
                    >
                      {formatDuration(file.uploadDurationMs)}
                    </Text>
                  </View>
                  {file.size > 0 && (
                    <View
                      style={[styles.detailRow, { borderBottomColor: rowBorder }]}
                    >
                      <Text style={[styles.detailLabel, { color: textSecondary }]}>
                        Upload Speed
                      </Text>
                      <Text
                        style={[
                          styles.detailValue,
                          { color: '#0284C7', fontWeight: 'bold' },
                        ]}
                      >
                        {formatSpeed(file.size / (file.uploadDurationMs / 1000))}
                      </Text>
                    </View>
                  )}
                </>
              )}

              {file.status === 'uploading' && file.progress !== undefined && (
                <View style={styles.detailRow}>
                  <Text style={[styles.detailLabel, { color: textSecondary }]}>
                    Progress
                  </Text>
                  <View style={styles.progressContainer}>
                    <View
                      style={[
                        styles.progressBar,
                        { backgroundColor: isDark ? '#334155' : '#E2E8F0' },
                      ]}
                    >
                      <View
                        style={[styles.progressFill, { width: `${file.progress}%` }]}
                      />
                    </View>
                    <Text style={styles.progressText}>{file.progress}%</Text>
                  </View>
                </View>
              )}
            </View>

            {/* Error Message if Failed */}
            {file.error && (
              <View
                style={[
                  styles.errorBox,
                  {
                    backgroundColor: isDark ? '#450A0A' : '#FEF2F2',
                    borderColor: isDark ? '#991B1B' : '#FCA5A5',
                  },
                ]}
              >
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    marginBottom: 6,
                  }}
                >
                  <FontAwesome
                    name="exclamation-triangle"
                    size={14}
                    color="#EF4444"
                    style={{ marginRight: 6 }}
                  />
                  <Text
                    style={[
                      styles.errorTitle,
                      { color: isDark ? '#FCA5A5' : '#DC2626' },
                    ]}
                  >
                    Error Description
                  </Text>
                </View>
                <Text
                  style={[
                    styles.errorMsg,
                    { color: isDark ? '#FECACA' : '#991B1B' },
                  ]}
                  selectable={true}
                >
                  {file.error}
                </Text>
              </View>
            )}
          </ScrollView>

          {/* Modern 2-Tier Balanced Action Buttons */}
          <View
            style={[
              styles.actionsContainer,
              { backgroundColor: footerBg, borderTopColor: border },
            ]}
          >
            {/* Tier 1: Primary Actions (Upload / Pause / Resume / Retry) */}
            {hasPrimaryActions && (
              <View style={styles.primaryActionRow}>
                {file.status === 'pending' && onUploadNow && (
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.uploadBtn]}
                    onPress={() => {
                      onClose();
                      onUploadNow(file);
                    }}
                    activeOpacity={0.8}
                  >
                    <FontAwesome
                      name="rocket"
                      size={14}
                      color="#FFF"
                      style={{ marginRight: 7 }}
                    />
                    <Text style={styles.actionBtnTextWhite}>Upload File</Text>
                  </TouchableOpacity>
                )}

                {(file.status === 'uploading' || file.status === 'pending') &&
                  onPause && (
                    <TouchableOpacity
                      style={[styles.actionBtn, styles.pauseBtn]}
                      onPress={() => {
                        onClose();
                        onPause(file);
                      }}
                      activeOpacity={0.8}
                    >
                      <FontAwesome
                        name="pause"
                        size={14}
                        color="#FFF"
                        style={{ marginRight: 7 }}
                      />
                      <Text style={styles.actionBtnTextWhite}>Pause</Text>
                    </TouchableOpacity>
                  )}

                {file.status === 'paused' && onResume && (
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.resumeBtn]}
                    onPress={() => {
                      onClose();
                      onResume(file);
                    }}
                    activeOpacity={0.8}
                  >
                    <FontAwesome
                      name="play"
                      size={14}
                      color="#FFF"
                      style={{ marginRight: 7 }}
                    />
                    <Text style={styles.actionBtnTextWhite}>Resume</Text>
                  </TouchableOpacity>
                )}

                {file.status === 'failed' && onRetry && (
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.retryBtn]}
                    onPress={() => {
                      onClose();
                      onRetry(file);
                    }}
                    activeOpacity={0.8}
                  >
                    <FontAwesome
                      name="refresh"
                      size={14}
                      color="#FFF"
                      style={{ marginRight: 7 }}
                    />
                    <Text style={styles.actionBtnTextWhite}>Retry Upload</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            {(file.isHistory || file.status === 'dismissed') && onRetry && (
              <View style={styles.primaryActionRow}>
                <TouchableOpacity
                  style={[styles.actionBtn, styles.uploadBtn]}
                  onPress={() => {
                    onClose();
                    onRetry(file);
                  }}
                  activeOpacity={0.8}
                >
                  <FontAwesome
                    name="refresh"
                    size={14}
                    color="#FFF"
                    style={{ marginRight: 7 }}
                  />
                  <Text style={styles.actionBtnTextWhite}>Re-queue Upload</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Tier 2: Secondary Actions (Discard & Close cleanly side-by-side) */}
            <View style={styles.secondaryActionRow}>
              {!file.isHistory && file.status !== 'completed' && onDiscard && (
                <TouchableOpacity
                  style={[
                    styles.actionBtn,
                    styles.discardBtn,
                    {
                      backgroundColor: isDark
                        ? 'rgba(239, 68, 68, 0.15)'
                        : '#FEE2E2',
                      borderColor: isDark ? '#7F1D1D' : '#FECACA',
                    },
                  ]}
                  onPress={() => {
                    onClose();
                    onDiscard(file);
                  }}
                  activeOpacity={0.7}
                >
                  <FontAwesome
                    name="trash-o"
                    size={14}
                    color="#EF4444"
                    style={{ marginRight: 6 }}
                  />
                  <Text style={styles.discardBtnText}>Discard</Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                style={[
                  styles.actionBtn,
                  styles.closeModalBtn,
                  {
                    backgroundColor: isDark ? '#334155' : '#F1F5F9',
                    borderColor: border,
                  },
                ]}
                onPress={onClose}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.closeModalBtnText,
                    { color: isDark ? '#F1F5F9' : '#475569' },
                  ]}
                >
                  Close
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalCard: {
    borderRadius: 18,
    width: '100%',
    maxHeight: '85%',
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 12,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 10,
  },
  fileIconContainer: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  headerTextContainer: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 3,
  },
  statusBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  statusBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  closeBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    justifyContent: 'center',
    alignItems: 'center',
  },
  body: {
    padding: 14,
    maxHeight: 380,
  },
  section: {
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 8,
  },
  detailBlock: {
    paddingVertical: 6,
    borderBottomWidth: 1,
  },
  detailBlockLabel: {
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 4,
  },
  fileNameBox: {
    fontSize: 12,
    fontWeight: '500',
    padding: 8,
    borderRadius: 8,
    borderWidth: 1,
    lineHeight: 18,
  },
  uriBox: {
    fontSize: 11,
    padding: 8,
    borderRadius: 8,
    borderWidth: 1,
    fontFamily: 'monospace',
    lineHeight: 16,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 7,
    borderBottomWidth: 1,
  },
  detailLabel: {
    fontSize: 12,
    fontWeight: '500',
    width: 90,
  },
  detailValue: {
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'right',
  },
  detailSubValue: {
    fontSize: 10,
    textAlign: 'right',
    marginTop: 1,
  },
  sizeHighlight: {
    fontWeight: '800',
    color: '#7C3AED',
    fontSize: 13,
  },
  destHighlight: {
    color: '#2563EB',
    fontWeight: '700',
  },
  streamPill: {
    marginTop: 3,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    alignSelf: 'flex-end',
  },
  streamPillText: {
    fontSize: 10,
    fontWeight: '700',
  },
  durationHighlight: {
    color: '#D97706',
    fontWeight: '700',
  },
  progressContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
  },
  progressBar: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#F59E0B',
  },
  progressText: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#F59E0B',
    width: 35,
    textAlign: 'right',
  },
  errorBox: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    marginTop: 4,
    marginBottom: 8,
  },
  errorTitle: {
    fontSize: 11,
    fontWeight: '700',
  },
  errorMsg: {
    fontSize: 11,
    lineHeight: 16,
  },
  actionsContainer: {
    padding: 14,
    borderTopWidth: 1,
  },
  primaryActionRow: {
    flexDirection: 'row',
    gap: 8,
  },
  secondaryActionRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  actionBtn: {
    flex: 1,
    minHeight: 42,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  uploadBtn: {
    backgroundColor: '#7C3AED',
  },
  pauseBtn: {
    backgroundColor: '#D97706',
  },
  resumeBtn: {
    backgroundColor: '#16A34A',
  },
  retryBtn: {
    backgroundColor: '#DC2626',
  },
  actionBtnTextWhite: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  discardBtn: {
    borderWidth: 1,
  },
  discardBtnText: {
    color: '#EF4444',
    fontSize: 13,
    fontWeight: '700',
  },
  closeModalBtn: {
    borderWidth: 1,
  },
  closeModalBtnText: {
    fontSize: 13,
    fontWeight: '700',
  },
});
