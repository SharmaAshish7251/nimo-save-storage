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

export function getFileCategory(
  fileName: string,
  mimeType?: string
): 'image' | 'video' | 'audio' | 'document' | 'other' {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  const mime = (mimeType || '').toLowerCase();

  if (
    mime.startsWith('image/') ||
    ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'bmp', 'svg'].includes(ext)
  ) {
    return 'image';
  }
  if (
    mime.startsWith('video/') ||
    ['mp4', 'mkv', 'mov', '3gp', 'avi', 'webm', 'ts'].includes(ext)
  ) {
    return 'video';
  }
  if (
    mime.startsWith('audio/') ||
    ['mp3', 'm4a', 'wav', 'aac', 'flac', 'ogg', 'opus'].includes(ext)
  ) {
    return 'audio';
  }
  if (
    mime.startsWith('application/pdf') ||
    mime.startsWith('text/') ||
    [
      'pdf',
      'doc',
      'docx',
      'xls',
      'xlsx',
      'ppt',
      'pptx',
      'txt',
      'csv',
      'zip',
      'rar',
      '7z',
      'tar',
      'gz',
    ].includes(ext)
  ) {
    return 'document';
  }

  return 'other';
}

export async function pickSingleFile(): Promise<ScannedFile | null> {
  try {
    const result = await DocumentPicker.getDocumentAsync({
      type: '*/*',
      copyToCacheDirectory: false,
    });

    if (result.canceled || !result.assets || result.assets.length === 0) {
      return null;
    }

    const asset = result.assets[0];
    let size = asset.size || 0;
    if (!size) {
      const info = await getFileInfo(asset.uri);
      size = info.size;
    }

    return {
      uri: asset.uri,
      fileName: asset.name,
      size,
      mimeType: asset.mimeType,
      source: 'document',
    };
  } catch (error) {
    console.error('Error picking single file:', error);
    return null;
  }
}

export interface MediaAlbum {
  id: string;
  title: string;
  assetCount: number;
}

export async function getMediaAlbums(): Promise<MediaAlbum[]> {
  const hasPermission = await requestMediaPermissions();
  if (!hasPermission) return [];

  try {
    const albums = await MediaLibrary.getAlbumsAsync({
      includeSmartAlbums: true,
    });
    return albums
      .filter((a) => a.assetCount > 0)
      .map((a) => ({
        id: a.id,
        title: a.title,
        assetCount: a.assetCount,
      }));
  } catch (error) {
    console.error('Error getting media albums:', error);
    return [];
  }
}

export async function getFilesFromAlbum(albumId: string): Promise<ScannedFile[]> {
  const hasPermission = await requestMediaPermissions();
  if (!hasPermission) return [];

  try {
    const assets = await MediaLibrary.getAssetsAsync({
      album: albumId,
      mediaType: ['photo', 'video', 'audio'],
      first: 2000,
      sortBy: ['creationTime'],
    });

    const files: ScannedFile[] = [];
    for (const asset of assets.assets) {
      const info = await MediaLibrary.getAssetInfoAsync(asset);
      files.push({
        uri: info.localUri || asset.uri,
        fileName: asset.filename,
        size: 0,
        mimeType: asset.mediaType,
        modificationTime: asset.creationTime,
        source: 'media',
      });
    }

    // Populate sizes
    const withSizes: ScannedFile[] = [];
    for (const file of files) {
      const info = await getFileInfo(file.uri);
      withSizes.push({ ...file, size: info.size });
    }

    return withSizes;
  } catch (error) {
    console.error(`Error loading album ${albumId}:`, error);
    return [];
  }
}

export async function requestAndScanSAFDirectory(): Promise<{
  directoryUri: string;
  files: ScannedFile[];
} | null> {
  try {
    const permissions =
      await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();

    if (!permissions.granted) {
      return null;
    }

    const directoryUri = permissions.directoryUri;
    const fileUris =
      await FileSystem.StorageAccessFramework.readDirectoryAsync(directoryUri);

    const files: ScannedFile[] = [];
    for (const fileUri of fileUris) {
      const name = decodeURIComponent(fileUri.split('%2F').pop() || 'file');
      const info = await getFileInfo(fileUri);
      if (info.exists) {
        files.push({
          uri: fileUri,
          fileName: name,
          size: info.size,
          source: 'document',
        });
      }
    }

    return { directoryUri, files };
  } catch (error) {
    console.error('Error reading SAF directory:', error);
    return null;
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
