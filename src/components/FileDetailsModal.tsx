import React from 'react';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { formatFileSize, formatDuration, formatSpeed } from '@/lib/storage/queue';
import { getFileCategory } from '@/lib/scanner/files';

export interface FileDetailData {
  id?: string;
  fileName: string;
  uri: string;
  size: number;
  mimeType?: string;
  status?: 'pending' | 'uploading' | 'completed' | 'failed' | 'paused' | 'uploaded' | 'dismissed' | string;
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
  onClose,
  onDiscard,
  onRetry,
  onUploadNow,
  onPause,
  onResume,
}: Props) {
  if (!file) return null;

  const category = getFileCategory(file.fileName, file.mimeType);

  const getCategoryIcon = (cat: string, size = 24) => {
    switch (cat) {
      case 'image': return <FontAwesome name="picture-o" size={size} color="#208AEF" />;
      case 'video': return <FontAwesome name="video-camera" size={size} color="#8B5CF6" />;
      case 'audio': return <FontAwesome name="music" size={size} color="#EC4899" />;
      case 'document': return <FontAwesome name="file-text-o" size={size} color="#10B981" />;
      default: return <FontAwesome name="file-o" size={size} color="#6B7280" />;
    }
  };

  const getStatusColor = (status?: string) => {
    switch (status) {
      case 'completed':
      case 'uploaded': return '#4CAF50';
      case 'uploading': return '#FF9800';
      case 'paused': return '#EAB308';
      case 'failed': return '#F44336';
      case 'pending': return '#208AEF';
      case 'dismissed': return '#888888';
      default: return '#666';
    }
  };

  const formatTimestamp = (ts?: number) => {
    if (!ts) return '—';
    const d = new Date(ts);
    const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const today = new Date();
    const isToday =
      d.getDate() === today.getDate() &&
      d.getMonth() === today.getMonth() &&
      d.getFullYear() === today.getFullYear();

    if (isToday) {
      return `Today at ${timeStr}`;
    }
    return `${d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })} at ${timeStr}`;
  };

  const statusColor = getStatusColor(file.status);
  const statusLabel = file.status ? file.status.toUpperCase() : 'UNKNOWN';

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent={true}
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <View style={styles.fileIconContainer}>{getCategoryIcon(category, 26)}</View>
              <View style={styles.headerTextContainer}>
                <Text style={styles.headerTitle} numberOfLines={1}>
                  {file.fileName}
                </Text>
                <View style={[styles.statusBadge, { backgroundColor: statusColor + '20' }]}>
                  <Text style={[styles.statusBadgeText, { color: statusColor }]}>
                    ● {statusLabel}
                  </Text>
                </View>
              </View>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <FontAwesome name="times" size={18} color="#6B7280" />
            </TouchableOpacity>
          </View>

          {/* Details Scroll Area */}
          <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
            {/* File Info Section */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>File Information</Text>

              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Full Name</Text>
                <Text style={styles.detailValue} selectable={true}>
                  {file.fileName}
                </Text>
              </View>

              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Total Size</Text>
                <View>
                  <Text style={[styles.detailValue, styles.sizeHighlight]}>
                    {formatFileSize(file.size)}
                  </Text>
                  <Text style={styles.detailSubValue}>
                    {file.size?.toLocaleString()} bytes
                  </Text>
                </View>
              </View>

              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Category</Text>
                <Text style={styles.detailValue}>
                  {category.charAt(0).toUpperCase() + category.slice(1)} {file.mimeType ? `(${file.mimeType})` : ''}
                </Text>
              </View>

              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>File Path</Text>
                <Text style={[styles.detailValue, styles.uriText]} numberOfLines={3} selectable={true}>
                  {file.uri}
                </Text>
              </View>
            </View>

            {/* Upload & Time Info Section */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Upload Details</Text>

              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Destination</Text>
                <Text style={[styles.detailValue, styles.destHighlight]}>
                  {file.destination || 'Saved Messages (Default)'}
                </Text>
              </View>

              {file.addedAt && (
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Added to Queue</Text>
                  <Text style={styles.detailValue}>{formatTimestamp(file.addedAt)}</Text>
                </View>
              )}

              {file.uploadStartedAt && (
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Upload Started</Text>
                  <Text style={styles.detailValue}>{formatTimestamp(file.uploadStartedAt)}</Text>
                </View>
              )}

              {(file.uploadedAt || (file.status === 'uploaded' && file.timestamp)) && (
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Uploaded At</Text>
                  <Text style={[styles.detailValue, { color: '#2E7D32', fontWeight: 'bold' }]}>
                    {formatTimestamp(file.uploadedAt || file.timestamp)}
                  </Text>
                </View>
              )}

              {file.uploadDurationMs && file.uploadDurationMs > 0 && (
                <>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Upload Duration</Text>
                    <Text style={[styles.detailValue, styles.durationHighlight]}>
                      {formatDuration(file.uploadDurationMs)}
                    </Text>
                  </View>
                  {file.size > 0 && (
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>Upload Speed</Text>
                      <Text style={[styles.detailValue, { color: '#0284C7', fontWeight: 'bold' }]}>
                        {formatSpeed(file.size / (file.uploadDurationMs / 1000))}
                      </Text>
                    </View>
                  )}
                </>
              )}

              {file.status === 'uploading' && file.progress !== undefined && (
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Progress</Text>
                  <View style={styles.progressContainer}>
                    <View style={styles.progressBar}>
                      <View style={[styles.progressFill, { width: `${file.progress}%` }]} />
                    </View>
                    <Text style={styles.progressText}>{file.progress}%</Text>
                  </View>
                </View>
              )}
            </View>

            {/* Error Message if Failed */}
            {file.error && (
              <View style={styles.errorBox}>
                <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 6 }}>
                  <FontAwesome name="exclamation-triangle" size={14} color="#DC2626" style={{ marginRight: 6 }} />
                  <Text style={styles.errorTitle}>Error Description</Text>
                </View>
                <Text style={styles.errorMsg} selectable={true}>
                  {file.error}
                </Text>
              </View>
            )}
          </ScrollView>

          {/* Action Buttons */}
          <View style={styles.actions}>
            {!file.isHistory && file.status === 'pending' && onUploadNow && (
              <TouchableOpacity
                style={styles.primaryBtn}
                onPress={() => {
                  onClose();
                  onUploadNow(file);
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center" }}>
                  <FontAwesome name="rocket" size={14} color="#FFF" style={{ marginRight: 8 }} />
                  <Text style={styles.primaryBtnText}>Upload File</Text>
                </View>
              </TouchableOpacity>
            )}

            {!file.isHistory && (file.status === 'uploading' || file.status === 'pending') && onPause && (
              <TouchableOpacity
                style={[styles.primaryBtn, { backgroundColor: '#D97706' }]}
                onPress={() => {
                  onClose();
                  onPause(file);
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center" }}>
                  <FontAwesome name="pause" size={14} color="#FFF" style={{ marginRight: 8 }} />
                  <Text style={styles.primaryBtnText}>Pause</Text>
                </View>
              </TouchableOpacity>
            )}

            {!file.isHistory && file.status === 'paused' && onResume && (
              <TouchableOpacity
                style={[styles.primaryBtn, { backgroundColor: '#16A34A' }]}
                onPress={() => {
                  onClose();
                  onResume(file);
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center" }}>
                  <FontAwesome name="play" size={14} color="#FFF" style={{ marginRight: 8 }} />
                  <Text style={styles.primaryBtnText}>Resume</Text>
                </View>
              </TouchableOpacity>
            )}

            {!file.isHistory && file.status === 'failed' && onRetry && (
              <TouchableOpacity
                style={[styles.primaryBtn, { backgroundColor: '#DC2626' }]}
                onPress={() => {
                  onClose();
                  onRetry(file);
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center" }}>
                  <FontAwesome name="refresh" size={14} color="#FFF" style={{ marginRight: 8 }} />
                  <Text style={styles.primaryBtnText}>Retry Upload</Text>
                </View>
              </TouchableOpacity>
            )}

            {(file.isHistory || file.status === 'dismissed') && onRetry && (
              <TouchableOpacity
                style={styles.primaryBtn}
                onPress={() => {
                  onClose();
                  onRetry(file);
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center" }}>
                  <FontAwesome name="refresh" size={14} color="#FFF" style={{ marginRight: 8 }} />
                  <Text style={styles.primaryBtnText}>Re-queue Upload</Text>
                </View>
              </TouchableOpacity>
            )}

            {!file.isHistory && file.status !== 'completed' && onDiscard && (
              <TouchableOpacity
                style={styles.dangerBtn}
                onPress={() => {
                  onClose();
                  onDiscard(file);
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center" }}>
                  <FontAwesome name="trash-o" size={14} color="#DC2626" style={{ marginRight: 6 }} />
                  <Text style={styles.dangerBtnText}>Discard</Text>
                </View>
              </TouchableOpacity>
            )}

            <TouchableOpacity style={styles.secondaryBtn} onPress={onClose}>
              <Text style={styles.secondaryBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 18,
  },
  modalCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    width: '100%',
    maxHeight: '85%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 8,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    backgroundColor: '#FAF5FF',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 10,
  },
  fileIconContainer: {
    width: 38,
    height: 38,
    borderRadius: 8,
    backgroundColor: "#F3F4F6",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  fileIcon: {
    fontSize: 28,
    marginRight: 10,
  },
  headerTextContainer: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#1E293B',
    marginBottom: 4,
  },
  statusBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  statusBadgeText: {
    fontSize: 10,
    fontWeight: 'bold',
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F1F5F9',
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeBtnText: {
    fontSize: 16,
    color: '#64748B',
    fontWeight: 'bold',
  },
  body: {
    padding: 16,
    maxHeight: 380,
  },
  section: {
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#475569',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  detailLabel: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '500',
    width: 100,
  },
  detailValue: {
    fontSize: 12,
    color: '#1E293B',
    flex: 1,
    textAlign: 'right',
    fontWeight: '500',
  },
  detailSubValue: {
    fontSize: 10,
    color: '#94A3B8',
    textAlign: 'right',
    marginTop: 1,
  },
  sizeHighlight: {
    fontWeight: 'bold',
    color: '#7C3AED',
    fontSize: 13,
  },
  destHighlight: {
    color: '#208AEF',
    fontWeight: 'bold',
  },
  durationHighlight: {
    color: '#D97706',
    fontWeight: 'bold',
  },
  uriText: {
    fontSize: 11,
    color: '#64748B',
    fontFamily: 'monospace',
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
    backgroundColor: '#E2E8F0',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#FF9800',
  },
  progressText: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#FF9800',
    width: 35,
    textAlign: 'right',
  },
  errorBox: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FCA5A5',
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
  },
  errorTitle: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#DC2626',
    marginBottom: 4,
  },
  errorMsg: {
    fontSize: 11,
    color: '#991B1B',
    lineHeight: 16,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 14,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    backgroundColor: '#FAF5FF',
  },
  primaryBtn: {
    flex: 1,
    minWidth: 120,
    backgroundColor: '#7C3AED',
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: 'bold',
  },
  dangerBtn: {
    backgroundColor: '#FEE2E2',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  dangerBtnText: {
    color: '#DC2626',
    fontSize: 13,
    fontWeight: 'bold',
  },
  secondaryBtn: {
    backgroundColor: '#F1F5F9',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  secondaryBtnText: {
    color: '#475569',
    fontSize: 13,
    fontWeight: '600',
  },
});
