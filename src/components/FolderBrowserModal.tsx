import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  FlatList,
  ActivityIndicator,
  Alert,
} from 'react-native';
import {
  ScannedFile,
  MediaAlbum,
  getMediaAlbums,
  getFilesFromAlbum,
  requestAndScanSAFDirectory,
  getFileCategory,
} from '@/lib/scanner/files';

type FileCategoryFilter = 'all' | 'image' | 'video' | 'audio' | 'document';

interface Props {
  visible: boolean;
  onClose: () => void;
  onFilesSelected: (files: ScannedFile[], uploadNow: boolean) => void;
}

export function FolderBrowserModal({ visible, onClose, onFilesSelected }: Props) {
  const [step, setStep] = useState<'pick_folder' | 'select_files'>('pick_folder');
  const [loading, setLoading] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [albums, setAlbums] = useState<MediaAlbum[]>([]);
  const [allFiles, setAllFiles] = useState<ScannedFile[]>([]);
  const [selectedUris, setSelectedUris] = useState<Set<string>>(new Set());
  const [activeFilter, setActiveFilter] = useState<FileCategoryFilter>('all');

  const loadAlbums = async () => {
    setLoading(true);
    try {
      const list = await getMediaAlbums();
      setAlbums(list);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (visible) {
      setStep('pick_folder');
      setAllFiles([]);
      setSelectedUris(new Set());
      setActiveFilter('all');
      loadAlbums();
    }
  }, [visible]);

  const handleSelectAlbum = async (album: MediaAlbum) => {
    setLoading(true);
    try {
      setFolderName(`Gallery: ${album.title}`);
      const files = await getFilesFromAlbum(album.id);
      setAllFiles(files);
      // By default select all
      setSelectedUris(new Set(files.map((f) => f.uri)));
      setStep('select_files');
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to load album files');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectSAFDirectory = async () => {
    setLoading(true);
    try {
      const result = await requestAndScanSAFDirectory();
      if (!result) return;
      const cleanName = decodeURIComponent(result.directoryUri.split('%3A').pop() || 'Selected Folder');
      setFolderName(`Folder: ${cleanName}`);
      setAllFiles(result.files);
      // By default select all
      setSelectedUris(new Set(result.files.map((f) => f.uri)));
      setStep('select_files');
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to open directory');
    } finally {
      setLoading(false);
    }
  };

  const toggleSelect = (uri: string) => {
    const next = new Set(selectedUris);
    if (next.has(uri)) {
      next.delete(uri);
    } else {
      next.add(uri);
    }
    setSelectedUris(next);
  };

  const selectAllFiltered = () => {
    const next = new Set(selectedUris);
    filteredFiles.forEach((f) => next.add(f.uri));
    setSelectedUris(next);
  };

  const deselectAllFiltered = () => {
    const next = new Set(selectedUris);
    filteredFiles.forEach((f) => next.delete(f.uri));
    setSelectedUris(next);
  };

  const filteredFiles = allFiles.filter((f) => {
    if (activeFilter === 'all') return true;
    return getFileCategory(f.fileName, f.mimeType) === activeFilter;
  });

  const selectedFiles = allFiles.filter((f) => selectedUris.has(f.uri));
  const totalSelectedBytes = selectedFiles.reduce((acc, f) => acc + (f.size || 0), 0);
  const totalSelectedMB = (totalSelectedBytes / 1024 / 1024).toFixed(1);

  // Counts for filter chips
  const categoryCounts = allFiles.reduce(
    (acc, f) => {
      const cat = getFileCategory(f.fileName, f.mimeType);
      if (cat in acc) acc[cat as keyof typeof acc]++;
      return acc;
    },
    { image: 0, video: 0, audio: 0, document: 0, other: 0 }
  );

  const confirmSelection = (uploadNow: boolean) => {
    if (selectedFiles.length === 0) {
      Alert.alert('Notice', 'Please select at least one file');
      return;
    }
    onFilesSelected(selectedFiles, uploadNow);
    onClose();
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'image': return '🖼️';
      case 'video': return '🎥';
      case 'audio': return '🎵';
      case 'document': return '📄';
      default: return '📁';
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent={true} onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContainer}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.headerTitle}>
              {step === 'pick_folder' ? 'Choose Folder / Album' : folderName}
            </Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Text style={styles.closeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>

          {loading ? (
            <View style={styles.centerContainer}>
              <ActivityIndicator size="large" color="#208AEF" />
              <Text style={styles.loadingText}>Reading files...</Text>
            </View>
          ) : step === 'pick_folder' ? (
            /* STEP 1: PICK FOLDER */
            <View style={styles.folderStepContainer}>
              <TouchableOpacity
                style={styles.safButton}
                onPress={handleSelectSAFDirectory}
              >
                <Text style={styles.safButtonIcon}>📂</Text>
                <View style={styles.safButtonTexts}>
                  <Text style={styles.safButtonTitle}>Choose Device Storage Folder</Text>
                  <Text style={styles.safButtonSubtitle}>
                    Browse any folder on internal storage or SD card
                  </Text>
                </View>
              </TouchableOpacity>

              <Text style={styles.sectionSubtitle}>Or Pick a Gallery Album:</Text>
              <FlatList
                data={albums}
                keyExtractor={(item) => item.id}
                style={styles.albumsList}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.albumItem}
                    onPress={() => handleSelectAlbum(item)}
                  >
                    <Text style={styles.albumIcon}>📁</Text>
                    <View style={styles.albumInfo}>
                      <Text style={styles.albumTitle} numberOfLines={1}>
                        {item.title}
                      </Text>
                      <Text style={styles.albumCount}>{item.assetCount} items</Text>
                    </View>
                    <Text style={styles.chevron}>›</Text>
                  </TouchableOpacity>
                )}
                ListEmptyComponent={
                  <Text style={styles.emptyText}>No albums found</Text>
                }
              />
            </View>
          ) : (
            /* STEP 2: MULTI-SELECT & FILTER FILES */
            <View style={styles.selectStepContainer}>
              {/* Change Folder Banner */}
              <TouchableOpacity
                style={styles.changeFolderRow}
                onPress={() => setStep('pick_folder')}
              >
                <Text style={styles.changeFolderText}>← Change Folder</Text>
              </TouchableOpacity>

              {/* Filter Chips Bar */}
              <View style={styles.filterBar}>
                <TouchableOpacity
                  style={[styles.filterChip, activeFilter === 'all' && styles.filterChipActive]}
                  onPress={() => setActiveFilter('all')}
                >
                  <Text style={[styles.filterChipText, activeFilter === 'all' && styles.filterChipTextActive]}>
                    All ({allFiles.length})
                  </Text>
                </TouchableOpacity>

                {categoryCounts.image > 0 && (
                  <TouchableOpacity
                    style={[styles.filterChip, activeFilter === 'image' && styles.filterChipActive]}
                    onPress={() => setActiveFilter('image')}
                  >
                    <Text style={[styles.filterChipText, activeFilter === 'image' && styles.filterChipTextActive]}>
                      🖼️ Images ({categoryCounts.image})
                    </Text>
                  </TouchableOpacity>
                )}

                {categoryCounts.video > 0 && (
                  <TouchableOpacity
                    style={[styles.filterChip, activeFilter === 'video' && styles.filterChipActive]}
                    onPress={() => setActiveFilter('video')}
                  >
                    <Text style={[styles.filterChipText, activeFilter === 'video' && styles.filterChipTextActive]}>
                      🎥 Videos ({categoryCounts.video})
                    </Text>
                  </TouchableOpacity>
                )}

                {categoryCounts.audio > 0 && (
                  <TouchableOpacity
                    style={[styles.filterChip, activeFilter === 'audio' && styles.filterChipActive]}
                    onPress={() => setActiveFilter('audio')}
                  >
                    <Text style={[styles.filterChipText, activeFilter === 'audio' && styles.filterChipTextActive]}>
                      🎵 Audio ({categoryCounts.audio})
                    </Text>
                  </TouchableOpacity>
                )}

                {categoryCounts.document > 0 && (
                  <TouchableOpacity
                    style={[styles.filterChip, activeFilter === 'document' && styles.filterChipActive]}
                    onPress={() => setActiveFilter('document')}
                  >
                    <Text style={[styles.filterChipText, activeFilter === 'document' && styles.filterChipTextActive]}>
                      📄 Docs ({categoryCounts.document})
                    </Text>
                  </TouchableOpacity>
                )}
              </View>

              {/* Selection Controls */}
              <View style={styles.selectionControlsRow}>
                <Text style={styles.selectionCountText}>
                  {selectedFiles.length} selected ({totalSelectedMB} MB)
                </Text>
                <View style={styles.selectionBtnGroup}>
                  <TouchableOpacity style={styles.smallActionBtn} onPress={selectAllFiltered}>
                    <Text style={styles.smallActionBtnText}>Select All</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.smallActionBtn} onPress={deselectAllFiltered}>
                    <Text style={styles.smallActionBtnText}>Deselect</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Files List with Checkboxes */}
              <FlatList
                data={filteredFiles}
                keyExtractor={(item) => item.uri}
                style={styles.filesList}
                renderItem={({ item }) => {
                  const isChecked = selectedUris.has(item.uri);
                  const cat = getFileCategory(item.fileName, item.mimeType);
                  return (
                    <TouchableOpacity
                      style={[styles.fileRow, isChecked && styles.fileRowChecked]}
                      onPress={() => toggleSelect(item.uri)}
                      activeOpacity={0.7}
                    >
                      <View style={[styles.checkbox, isChecked && styles.checkboxChecked]}>
                        {isChecked && <Text style={styles.checkMark}>✓</Text>}
                      </View>
                      <Text style={styles.fileCatIcon}>{getCategoryIcon(cat)}</Text>
                      <View style={styles.fileDetails}>
                        <Text style={styles.fileNameText} numberOfLines={1}>
                          {item.fileName}
                        </Text>
                        <Text style={styles.fileSubText}>
                          {item.size ? (item.size / 1024 / 1024).toFixed(2) + ' MB' : '0 MB'}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                }}
                ListEmptyComponent={
                  <Text style={styles.emptyText}>No files match this filter</Text>
                }
              />

              {/* Bottom Action Footer */}
              <View style={styles.footerRow}>
                <TouchableOpacity
                  style={[styles.queueButton, selectedFiles.length === 0 && styles.buttonDisabled]}
                  disabled={selectedFiles.length === 0}
                  onPress={() => confirmSelection(false)}
                >
                  <Text style={styles.queueButtonText}>Add to Queue ({selectedFiles.length})</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.uploadNowButton, selectedFiles.length === 0 && styles.buttonDisabled]}
                  disabled={selectedFiles.length === 0}
                  onPress={() => confirmSelection(true)}
                >
                  <Text style={styles.uploadNowButtonText}>Upload Now</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 16,
    paddingBottom: 24,
    maxHeight: '92%',
    minHeight: '60%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#222',
    flex: 1,
  },
  closeBtn: {
    padding: 6,
  },
  closeBtnText: {
    fontSize: 18,
    color: '#888',
  },
  centerContainer: {
    padding: 40,
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: '#666',
  },
  folderStepContainer: {
    padding: 16,
    flex: 1,
  },
  safButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EBF4FE',
    padding: 14,
    borderRadius: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#D0E3FC',
  },
  safButtonIcon: {
    fontSize: 28,
    marginRight: 12,
  },
  safButtonTexts: {
    flex: 1,
  },
  safButtonTitle: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#1D72B8',
  },
  safButtonSubtitle: {
    fontSize: 11,
    color: '#555',
    marginTop: 2,
  },
  sectionSubtitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#666',
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  albumsList: {
    maxHeight: 360,
  },
  albumItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  albumIcon: {
    fontSize: 22,
    marginRight: 12,
  },
  albumInfo: {
    flex: 1,
  },
  albumTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#222',
  },
  albumCount: {
    fontSize: 12,
    color: '#888',
    marginTop: 2,
  },
  chevron: {
    fontSize: 20,
    color: '#ccc',
  },
  selectStepContainer: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  changeFolderRow: {
    paddingVertical: 4,
    marginBottom: 8,
  },
  changeFolderText: {
    color: '#208AEF',
    fontSize: 13,
    fontWeight: '600',
  },
  filterBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 10,
  },
  filterChip: {
    backgroundColor: '#f1f3f5',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
  },
  filterChipActive: {
    backgroundColor: '#208AEF',
  },
  filterChipText: {
    fontSize: 12,
    color: '#555',
    fontWeight: '500',
  },
  filterChipTextActive: {
    color: '#fff',
    fontWeight: 'bold',
  },
  selectionControlsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    marginBottom: 6,
  },
  selectionCountText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#333',
  },
  selectionBtnGroup: {
    flexDirection: 'row',
    gap: 8,
  },
  smallActionBtn: {
    backgroundColor: '#EBF4FE',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  smallActionBtnText: {
    fontSize: 11,
    color: '#208AEF',
    fontWeight: '600',
  },
  filesList: {
    maxHeight: 320,
  },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 8,
    marginBottom: 4,
  },
  fileRowChecked: {
    backgroundColor: '#F0F7FF',
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: '#aaa',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  checkboxChecked: {
    backgroundColor: '#208AEF',
    borderColor: '#208AEF',
  },
  checkMark: {
    color: '#fff',
    fontSize: 13,
    fontWeight: 'bold',
  },
  fileCatIcon: {
    fontSize: 18,
    marginRight: 10,
  },
  fileDetails: {
    flex: 1,
  },
  fileNameText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#222',
  },
  fileSubText: {
    fontSize: 11,
    color: '#888',
    marginTop: 2,
  },
  footerRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  queueButton: {
    flex: 1,
    backgroundColor: '#E5E7EB',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  queueButtonText: {
    color: '#374151',
    fontWeight: 'bold',
    fontSize: 14,
  },
  uploadNowButton: {
    flex: 1,
    backgroundColor: '#208AEF',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  uploadNowButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 14,
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  emptyText: {
    textAlign: 'center',
    color: '#999',
    marginVertical: 24,
    fontSize: 13,
  },
});
