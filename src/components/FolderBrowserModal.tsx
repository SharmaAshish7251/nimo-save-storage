import React, { useState, useEffect, useRef } from 'react';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  FlatList,
  ActivityIndicator,
} from 'react-native';
import {
  ScannedFile,
  MediaAlbum,
  getMediaAlbums,
  getFilesFromAlbum,
  requestAndScanSAFDirectory,
  getFileCategory,
} from '@/lib/scanner/files';
import {
  formatFileSize,
  WatchedFolder,
  getWatchedFolders,
  saveWatchedFolders,
} from '@/lib/storage/queue';
import { FileDetailsModal, FileDetailData } from './FileDetailsModal';

type FileCategoryFilter = 'all' | 'image' | 'video' | 'audio' | 'document';

interface Props {
  visible: boolean;
  onClose: () => void;
  onFilesSelected: (files: ScannedFile[], uploadNow: boolean) => void;
  onWatchedFoldersUpdated?: (folders: WatchedFolder[]) => void;
  onScanFoldersRequested?: (folders: WatchedFolder[]) => void;
}

export function FolderBrowserModal({
  visible,
  onClose,
  onFilesSelected,
  onWatchedFoldersUpdated,
  onScanFoldersRequested,
}: Props) {
  const [step, setStep] = useState<'pick_folder' | 'select_files'>('pick_folder');
  const [loading, setLoading] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [albums, setAlbums] = useState<MediaAlbum[]>([]);
  const [safFolders, setSafFolders] = useState<WatchedFolder[]>([]);
  const [selectedFolderIds, setSelectedFolderIds] = useState<Set<string>>(new Set());
  const [allFiles, setAllFiles] = useState<ScannedFile[]>([]);
  const [selectedUris, setSelectedUris] = useState<Set<string>>(new Set());
  const [activeFilter, setActiveFilter] = useState<FileCategoryFilter>('all');
  const [selectedFileForDetails, setSelectedFileForDetails] = useState<FileDetailData | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const [albumList, watched] = await Promise.all([
        getMediaAlbums(),
        getWatchedFolders(),
      ]);
      setAlbums(albumList);

      const safs = watched.filter((w) => w.type === 'saf');
      setSafFolders(safs);

      const activeIds = new Set(watched.map((w) => w.id));
      setSelectedFolderIds(activeIds);
    } catch (error) {
      console.error('Error loading albums and watched folders:', error);
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
      loadData();
    }
  }, [visible]);

  const isSelectingSafRef = useRef(false);

  // Handle opening an album to pick individual files
  const handleOpenAlbum = async (album: MediaAlbum) => {
    if (loading) return;
    setLoading(true);
    try {
      setFolderName(`Gallery: ${album.title}`);
      const files = await getFilesFromAlbum(album.id, album.title);
      setAllFiles(files);
      // By default start unselected (user chooses what they want)
      setSelectedUris(new Set());
      setStep('select_files');
    } catch {
    } finally {
      setLoading(false);
    }
  };

  // Handle picking a custom SAF directory
  const handleSelectSAFDirectory = async () => {
    if (isSelectingSafRef.current || loading) return;
    isSelectingSafRef.current = true;
    setLoading(true);
    try {
      const result = await requestAndScanSAFDirectory();
      if (!result) {
        // Fix 2.3: User simply cancelled the system folder picker — no error alert needed
        return;
      }

      const newSafFolder: WatchedFolder = {
        id: result.directoryUri,
        title: result.folderTitle,
        type: 'saf',
        assetCount: result.files.length,
      };

      setSafFolders((prev) => {
        const existing = prev.filter((f) => f.id !== newSafFolder.id);
        return [newSafFolder, ...existing];
      });

      setSelectedFolderIds((prev) => new Set(prev).add(newSafFolder.id));

      setFolderName(`Folder: ${result.folderTitle}`);
      setAllFiles(result.files);
      // By default start unselected
      setSelectedUris(new Set());
      setStep('select_files');
    } catch {
    } finally {
      setLoading(false);
      isSelectingSafRef.current = false;
    }
  };

  const toggleFolderSelection = (folder: WatchedFolder) => {
    const next = new Set(selectedFolderIds);
    if (next.has(folder.id)) {
      next.delete(folder.id);
    } else {
      next.add(folder.id);
    }
    setSelectedFolderIds(next);
  };

  const getCombinedWatchedFolders = (): WatchedFolder[] => {
    const albumFolders: WatchedFolder[] = albums
      .filter((a) => selectedFolderIds.has(a.id))
      .map((a) => ({
        id: a.id,
        title: a.title,
        type: 'album',
        assetCount: a.assetCount,
      }));

    const activeSafs = safFolders.filter((s) => selectedFolderIds.has(s.id));
    return [...albumFolders, ...activeSafs];
  };

  const handleSaveWatchedFolders = async (scanNow: boolean) => {
    const chosen = getCombinedWatchedFolders();
    await saveWatchedFolders(chosen);
    if (onWatchedFoldersUpdated) {
      onWatchedFoldersUpdated(chosen);
    }

    if (scanNow && onScanFoldersRequested) {
      onClose();
      onScanFoldersRequested(chosen);
    } else {
      onClose();
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
      return;
    }
    onFilesSelected(selectedFiles, uploadNow);
    onClose();
  };

  const getCategoryIcon = (category: string, size = 18) => {
    switch (category) {
      case 'image': return <FontAwesome name="picture-o" size={size} color="#208AEF" />;
      case 'video': return <FontAwesome name="video-camera" size={size} color="#8B5CF6" />;
      case 'audio': return <FontAwesome name="music" size={size} color="#EC4899" />;
      case 'document': return <FontAwesome name="file-text-o" size={size} color="#10B981" />;
      default: return <FontAwesome name="folder" size={size} color="#F59E0B" />;
    }
  };

  const selectedFoldersCount = selectedFolderIds.size;

  return (
    <Modal visible={visible} animationType="slide" transparent={true} onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContainer}>
          {/* Header */}
          <View style={styles.header}>
            <View>
              <Text style={styles.headerTitle}>
                {step === 'pick_folder' ? 'Choose Folders to Scan' : folderName}
              </Text>
              {step === 'pick_folder' && (
                <Text style={styles.headerSubtitle}>
                  Check folders to watch, or tap to open and select files
                </Text>
              )}
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <FontAwesome name="times" size={18} color="#6B7280" />
            </TouchableOpacity>
          </View>

          {loading ? (
            <View style={styles.centerContainer}>
              <ActivityIndicator size="large" color="#208AEF" />
              <Text style={styles.loadingText}>Loading folders & files...</Text>
            </View>
          ) : step === 'pick_folder' ? (
            /* STEP 1: MULTI-FOLDER SELECTION & ALBUM BROWSING */
            <View style={styles.folderStepContainer}>
              <TouchableOpacity
                style={[styles.safButton, loading && { opacity: 0.6 }]}
                onPress={handleSelectSAFDirectory}
                disabled={loading}
              >
                <View style={{ width: 28, alignItems: "center", justifyContent: "center", marginRight: 10 }}>
                  <FontAwesome name="folder-open" size={22} color="#208AEF" />
                </View>
                <View style={styles.safButtonTexts}>
                  <Text style={styles.safButtonTitle}>+ Add Device Storage Folder</Text>
                  <Text style={styles.safButtonSubtitle}>
                    Select a specific folder (e.g. DCIM, Movies, Pictures)
                  </Text>
                </View>
              </TouchableOpacity>

              <View style={styles.foldersHeaderRow}>
                <Text style={styles.sectionSubtitle}>
                  Folders / Albums ({selectedFoldersCount} selected):
                </Text>
              </View>

              <FlatList
                data={[
                  ...safFolders.map((s) => ({ ...s, isSaf: true })),
                  ...albums.map((a) => ({
                    id: a.id,
                    title: a.title,
                    type: 'album' as const,
                    assetCount: a.assetCount,
                    isSaf: false,
                  })),
                ]}
                keyExtractor={(item) => `${item.type}_${item.id}`}
                style={styles.albumsList}
                renderItem={({ item }) => {
                  const isChecked = selectedFolderIds.has(item.id);
                  return (
                    <View style={[styles.albumItem, isChecked && styles.albumItemActive]}>
                      <TouchableOpacity
                        style={styles.checkboxTouch}
                        onPress={() =>
                          toggleFolderSelection({
                            id: item.id,
                            title: item.title,
                            type: item.type,
                            assetCount: item.assetCount,
                          })
                        }
                      >
                        <View style={[styles.checkbox, isChecked && styles.checkboxActive]}>
                          {isChecked && <FontAwesome name="check" size={11} color="#FFF" />}
                        </View>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={styles.albumInfoTouch}
                        onPress={() => {
                          if (item.type === 'album') {
                            handleOpenAlbum({
                              id: item.id,
                              title: item.title,
                              assetCount: item.assetCount || 0,
                            });
                          }
                        }}
                      >
                        <View style={{ width: 26, alignItems: "center", justifyContent: "center", marginRight: 10 }}>
                          <FontAwesome name={item.isSaf ? "folder-open" : "folder"} size={18} color="#F59E0B" />
                        </View>
                        <View style={styles.albumInfo}>
                          <Text style={styles.albumTitle} numberOfLines={1}>
                            {item.title}
                          </Text>
                          <Text style={styles.albumCount}>
                            {item.assetCount ? `${item.assetCount} items` : 'Custom folder'}
                          </Text>
                        </View>
                        {item.type === 'album' && (
                          <Text style={styles.openAlbumHint}>Browse files ›</Text>
                        )}
                      </TouchableOpacity>
                    </View>
                  );
                }}
                ListEmptyComponent={
                  <Text style={styles.emptyText}>No albums or folders found</Text>
                }
              />

              {/* Bottom Actions for Multi-Folder Selection */}
              <View style={styles.folderBottomActions}>
                <TouchableOpacity
                  style={[
                    styles.primaryFolderBtn,
                    selectedFoldersCount === 0 && styles.disabledBtn,
                  ]}
                  disabled={selectedFoldersCount === 0}
                  onPress={() => handleSaveWatchedFolders(true)}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center" }}>
                    <FontAwesome name="bolt" size={14} color="#FFF" style={{ marginRight: 6 }} />
                    <Text style={styles.primaryFolderBtnText}>Scan Selected Folders ({selectedFoldersCount})</Text>
                  </View>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.secondaryFolderBtn}
                  onPress={() => handleSaveWatchedFolders(false)}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center" }}>
                    <FontAwesome name="floppy-o" size={14} color="#208AEF" style={{ marginRight: 6 }} />
                    <Text style={styles.secondaryFolderBtnText}>Save Folders Only ({selectedFoldersCount})</Text>
                  </View>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            /* STEP 2: MULTI-SELECT & FILTER FILES IN OPENED FOLDER */
            <View style={styles.selectStepContainer}>
              {/* Back to Folders */}
              <TouchableOpacity
                style={styles.changeFolderRow}
                onPress={() => setStep('pick_folder')}
              >
                <Text style={styles.changeFolderText}>← Back to Folders List</Text>
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
                    <FontAwesome name="picture-o" size={11} color={activeFilter === "image" ? "#fff" : "#208AEF"} style={{ marginRight: 4 }} />
                    <Text style={[styles.filterChipText, activeFilter === "image" && styles.filterChipTextActive]}>
                      Images ({categoryCounts.image})
                    </Text>
                  </TouchableOpacity>
                )}

                {categoryCounts.video > 0 && (
                  <TouchableOpacity
                    style={[styles.filterChip, activeFilter === 'video' && styles.filterChipActive]}
                    onPress={() => setActiveFilter('video')}
                  >
                    <FontAwesome name="video-camera" size={11} color={activeFilter === "video" ? "#fff" : "#8B5CF6"} style={{ marginRight: 4 }} />
                    <Text style={[styles.filterChipText, activeFilter === "video" && styles.filterChipTextActive]}>
                      Videos ({categoryCounts.video})
                    </Text>
                  </TouchableOpacity>
                )}

                {categoryCounts.audio > 0 && (
                  <TouchableOpacity
                    style={[styles.filterChip, activeFilter === 'audio' && styles.filterChipActive]}
                    onPress={() => setActiveFilter('audio')}
                  >
                    <FontAwesome name="music" size={11} color={activeFilter === "audio" ? "#fff" : "#EC4899"} style={{ marginRight: 4 }} />
                    <Text style={[styles.filterChipText, activeFilter === "audio" && styles.filterChipTextActive]}>
                      Audio ({categoryCounts.audio})
                    </Text>
                  </TouchableOpacity>
                )}

                {categoryCounts.document > 0 && (
                  <TouchableOpacity
                    style={[styles.filterChip, activeFilter === 'document' && styles.filterChipActive]}
                    onPress={() => setActiveFilter('document')}
                  >
                    <FontAwesome name="file-text-o" size={11} color={activeFilter === "document" ? "#fff" : "#10B981"} style={{ marginRight: 4 }} />
                    <Text style={[styles.filterChipText, activeFilter === "document" && styles.filterChipTextActive]}>
                      Docs ({categoryCounts.document})
                    </Text>
                  </TouchableOpacity>
                )}
              </View>

              {/* Batch Select Controls */}
              <View style={styles.batchControls}>
                <TouchableOpacity onPress={selectAllFiltered} style={styles.batchBtn}>
                  <View style={{ flexDirection: "row", alignItems: "center" }}>
                    <FontAwesome name="check-square-o" size={13} color="#208AEF" style={{ marginRight: 4 }} />
                    <Text style={styles.batchBtnText}>Select All</Text>
                  </View>
                </TouchableOpacity>
                <TouchableOpacity onPress={deselectAllFiltered} style={styles.batchBtn}>
                  <View style={{ flexDirection: "row", alignItems: "center" }}>
                    <FontAwesome name="square-o" size={13} color="#6B7280" style={{ marginRight: 4 }} />
                    <Text style={styles.batchBtnText}>Clear All</Text>
                  </View>
                </TouchableOpacity>
                <Text style={styles.selectedCountText}>
                  {selectedFiles.length} of {filteredFiles.length} selected
                </Text>
              </View>

              {/* Files List */}
              <FlatList
                data={filteredFiles}
                keyExtractor={(item) => item.uri}
                style={styles.filesList}
                renderItem={({ item }) => {
                  const isSelected = selectedUris.has(item.uri);
                  const category = getFileCategory(item.fileName, item.mimeType);
                  return (
                    <TouchableOpacity
                      style={[styles.fileItem, isSelected && styles.fileItemActive]}
                      onPress={() => toggleSelect(item.uri)}
                      activeOpacity={0.7}
                    >
                      <View style={[styles.checkbox, isSelected && styles.checkboxActive]}>
                        {isSelected && <FontAwesome name="check" size={11} color="#FFF" />}
                      </View>
                      <View style={{ width: 28, alignItems: "center", justifyContent: "center", marginHorizontal: 8 }}>
                        {getCategoryIcon(category, 18)}
                      </View>
                      <View style={styles.fileInfo}>
                        <Text style={styles.fileName} numberOfLines={1}>
                          {item.fileName}
                        </Text>
                        <Text style={styles.fileMeta}>
                          {item.size ? formatFileSize(item.size) : 'File'}
                        </Text>
                      </View>
                      <TouchableOpacity
                        style={styles.detailsBtn}
                        onPress={() => {
                          setSelectedFileForDetails({
                            fileName: item.fileName,
                            size: item.size || 0,
                            mimeType: item.mimeType,
                            uri: item.uri,
                          });
                        }}
                      >
                        <FontAwesome name="info-circle" size={16} color="#208AEF" />
                      </TouchableOpacity>
                    </TouchableOpacity>
                  );
                }}
                ListEmptyComponent={
                  <Text style={styles.emptyText}>No files match the selected filter</Text>
                }
              />

              {/* Bottom Actions */}
              <View style={styles.bottomBar}>
                <View style={styles.selectionSummary}>
                  <Text style={styles.summaryCount}>
                    {selectedFiles.length} files selected
                  </Text>
                  <Text style={styles.summarySize}>
                    {formatFileSize(totalSelectedBytes)}
                  </Text>
                </View>
                <View style={styles.actionButtons}>
                  <TouchableOpacity
                    style={[styles.queueBtn, selectedFiles.length === 0 && styles.disabledBtn]}
                    disabled={selectedFiles.length === 0}
                    onPress={() => confirmSelection(false)}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center" }}>
                      <FontAwesome name="plus" size={13} color="#208AEF" style={{ marginRight: 6 }} />
                      <Text style={styles.queueBtnText}>Add to Queue</Text>
                    </View>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.uploadNowBtn, selectedFiles.length === 0 && styles.disabledBtn]}
                    disabled={selectedFiles.length === 0}
                    onPress={() => confirmSelection(true)}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center" }}>
                      <FontAwesome name="rocket" size={13} color="#FFF" style={{ marginRight: 6 }} />
                      <Text style={styles.uploadNowBtnText}>Upload Now</Text>
                    </View>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          )}

          {selectedFileForDetails && (
            <FileDetailsModal
              visible={!!selectedFileForDetails}
              file={selectedFileForDetails}
              onClose={() => setSelectedFileForDetails(null)}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    height: '90%',
    display: 'flex',
    flexDirection: 'column',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: 'bold',
    color: '#1a1a1a',
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  closeBtn: {
    padding: 6,
  },
  closeBtnText: {
    fontSize: 20,
    color: '#888',
    fontWeight: 'bold',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: '#666',
  },
  folderStepContainer: {
    flex: 1,
    padding: 16,
  },
  safButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F0F7FF',
    borderColor: '#208AEF',
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderRadius: 12,
    padding: 14,
    marginBottom: 14,
  },
  safButtonIcon: {
    fontSize: 24,
    marginRight: 12,
  },
  safButtonTexts: {
    flex: 1,
  },
  safButtonTitle: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#208AEF',
  },
  safButtonSubtitle: {
    fontSize: 12,
    color: '#555',
    marginTop: 2,
  },
  foldersHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  sectionSubtitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#444',
  },
  albumsList: {
    flex: 1,
  },
  albumItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: '#f9f9f9',
    borderRadius: 10,
    marginBottom: 8,
  },
  albumItemActive: {
    backgroundColor: '#EBF4FF',
    borderColor: '#208AEF',
    borderWidth: 1,
  },
  checkboxTouch: {
    padding: 4,
    marginRight: 8,
  },
  albumInfoTouch: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
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
    color: '#1a1a1a',
  },
  albumCount: {
    fontSize: 12,
    color: '#777',
    marginTop: 2,
  },
  openAlbumHint: {
    fontSize: 12,
    color: '#208AEF',
    fontWeight: '600',
    paddingHorizontal: 8,
  },
  folderBottomActions: {
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#eee',
    gap: 8,
  },
  primaryFolderBtn: {
    backgroundColor: '#208AEF',
    paddingVertical: 13,
    borderRadius: 10,
    alignItems: 'center',
  },
  primaryFolderBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: 'bold',
  },
  secondaryFolderBtn: {
    backgroundColor: '#f0f0f0',
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
  },
  secondaryFolderBtnText: {
    color: '#333',
    fontSize: 14,
    fontWeight: '600',
  },
  selectStepContainer: {
    flex: 1,
  },
  changeFolderRow: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#f5f5f5',
  },
  changeFolderText: {
    color: '#208AEF',
    fontSize: 14,
    fontWeight: '600',
  },
  filterBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  filterChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 16,
    backgroundColor: '#f0f0f0',
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
  batchControls: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#fafafa',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  batchBtn: {
    marginRight: 14,
  },
  batchBtnText: {
    color: '#208AEF',
    fontSize: 13,
    fontWeight: '600',
  },
  selectedCountText: {
    marginLeft: 'auto',
    fontSize: 12,
    color: '#666',
  },
  filesList: {
    flex: 1,
    paddingHorizontal: 12,
  },
  fileItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
    borderRadius: 8,
  },
  fileItemActive: {
    backgroundColor: '#F0F7FF',
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: '#aaa',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  checkboxActive: {
    backgroundColor: '#208AEF',
    borderColor: '#208AEF',
  },
  checkmark: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  fileIcon: {
    fontSize: 20,
    marginRight: 10,
  },
  fileInfo: {
    flex: 1,
  },
  fileName: {
    fontSize: 14,
    fontWeight: '500',
    color: '#222',
  },
  fileMeta: {
    fontSize: 11,
    color: '#888',
    marginTop: 2,
  },
  detailsBtn: {
    padding: 6,
  },
  detailsBtnText: {
    fontSize: 16,
  },
  emptyText: {
    textAlign: 'center',
    color: '#888',
    marginTop: 40,
    fontSize: 14,
  },
  bottomBar: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#eee',
    backgroundColor: '#fff',
  },
  selectionSummary: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  summaryCount: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#222',
  },
  summarySize: {
    fontSize: 14,
    color: '#666',
  },
  actionButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  queueBtn: {
    flex: 1,
    backgroundColor: '#f0f0f0',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  queueBtnText: {
    color: '#333',
    fontSize: 14,
    fontWeight: 'bold',
  },
  uploadNowBtn: {
    flex: 1,
    backgroundColor: '#208AEF',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  uploadNowBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  disabledBtn: {
    opacity: 0.5,
  },
});
