import * as MediaLibrary from 'expo-media-library/legacy';
import * as FileSystem from 'expo-file-system/legacy';
import * as DocumentPicker from 'expo-document-picker';
import { getUploadedIndex } from '../storage/queue';

export interface ScannedFile {
  uri: string;
  fileName: string;
  size: number;
  mimeType?: string;
  modificationTime?: number;
  source: 'media' | 'document';
}

export async function requestMediaPermissions(): Promise<boolean> {
  const { status } = await MediaLibrary.requestPermissionsAsync();
  return status === 'granted';
}

export async function scanMediaLibrary(since?: number): Promise<ScannedFile[]> {
  const hasPermission = await requestMediaPermissions();
  if (!hasPermission) return [];
  
  try {
    const assets = await MediaLibrary.getAssetsAsync({
      mediaType: ['photo', 'video', 'audio'],
      first: 1000,
      sortBy: ['creationTime'],
    });
    
    const files: ScannedFile[] = [];
    for (const asset of assets.assets) {
      if (since && asset.creationTime && asset.creationTime < since) continue;
      const info = await MediaLibrary.getAssetInfoAsync(asset);
      files.push({
        uri: info.localUri || asset.uri,
        fileName: asset.filename,
        size: asset.duration ? 0 : 0, // Size not directly available, will need to get
        mimeType: asset.mediaType,
        modificationTime: asset.creationTime,
        source: 'media',
      });
    }
    return files;
  } catch (error) {
    console.error('Error scanning media library:', error);
    return [];
  }
}

export async function pickFolder(): Promise<string | null> {
  try {
    const result = await DocumentPicker.getDocumentAsync({
      type: '*/*',
      copyToCacheDirectory: false,
    });
    
    if (result.canceled) return null;
    return result.assets[0].uri;
  } catch (error) {
    console.error('Error picking folder:', error);
    return null;
  }
}

export async function getFileInfo(uri: string): Promise<{ size: number; exists: boolean }> {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    return {
      size: info.exists && !info.isDirectory ? (info.size || 0) : 0,
      exists: info.exists,
    };
  } catch {
    return { size: 0, exists: false };
  }
}

export async function scanForNewFiles(): Promise<ScannedFile[]> {
  const uploaded = await getUploadedIndex();
  const uploadedUris = new Set(uploaded.map(u => u.uri));
  
  const allFiles: ScannedFile[] = [];
  
  // Scan media library
  const mediaFiles = await scanMediaLibrary();
  allFiles.push(...mediaFiles);
  
  // Filter out already uploaded
  const newFiles = allFiles.filter(f => !uploadedUris.has(f.uri));
  
  // Get file sizes
  const filesWithSize: ScannedFile[] = [];
  for (const file of newFiles) {
    const info = await getFileInfo(file.uri);
    if (info.exists) {
      filesWithSize.push({ ...file, size: info.size });
    }
  }
  
  return filesWithSize;
}
