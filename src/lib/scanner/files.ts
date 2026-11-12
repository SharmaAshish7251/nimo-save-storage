import { Alert } from 'react-native';
import * as MediaLibrary from 'expo-media-library/legacy';
import * as FileSystem from 'expo-file-system/legacy';
import * as DocumentPicker from 'expo-document-picker';
import { getUploadedIndex, getWatchedFolders, getQueue, getConfig, WatchedFolder } from '../storage/queue';
import { getFileInfo, getFileCategory, resolveLocalFileTarget } from '../storage/fileHelper';

export { getFileInfo, getFileCategory };

export interface ScannedFile {
  uri: string;
  fileName: string;
  size: number;
  mimeType?: string;
  modificationTime?: number;
  source: 'media' | 'document';
  folderName?: string;
  mediaAssetId?: string;
}

export interface ScanOptions {
  folders?: WatchedFolder[];
  abortSignal?: AbortSignal;
  onProgress?: (scannedCount: number, currentFolder: string) => void;
}

export async function requestMediaPermissions(): Promise<boolean> {
  try {
    const current = await MediaLibrary.getPermissionsAsync();
    if (
      current.granted ||
      current.status === MediaLibrary.PermissionStatus.GRANTED ||
      (current.status as any) === 'limited'
    ) {
      return true;
    }
    const requested = await MediaLibrary.requestPermissionsAsync();
    return (
      requested.granted ||
      requested.status === MediaLibrary.PermissionStatus.GRANTED ||
      (requested.status as any) === 'limited'
    );
  } catch (error) {
    console.error('Error requesting media permissions:', error);
    return false;
  }
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

    const category = getFileCategory(asset.name, asset.mimeType);
    const isMedia = category === 'image' || category === 'video' || category === 'audio';

    // Resolve DocumentPicker content:// URIs into persistent local file:// URIs + MediaLibrary asset IDs
    // so uploads survive restarts and Free Up Space can track/delete them properly.
    const resolved = await resolveLocalFileTarget({
      uri: asset.uri,
      fileName: asset.name,
      size,
      mimeType: asset.mimeType,
      allowMediaMatch: true,
      requestPermission: isMedia,
    }).catch(() => null);

    const finalUri =
      resolved && resolved.exists && resolved.resolvedUri ? resolved.resolvedUri : asset.uri;
    const finalSize = resolved && resolved.size > 0 ? resolved.size : size;

    return {
      uri: finalUri,
      fileName: asset.name,
      size: finalSize,
      mimeType: asset.mimeType,
      source: resolved?.mediaAssetId ? 'media' : 'document',
      ...(resolved?.mediaAssetId ? { mediaAssetId: resolved.mediaAssetId } : {}),
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

export async function getFilesFromAlbum(
  albumId: string,
  folderTitle?: string,
  abortSignal?: AbortSignal
): Promise<ScannedFile[]> {
  const hasPermission = await requestMediaPermissions();
  if (!hasPermission || abortSignal?.aborted) return [];

  try {
    const assets = await MediaLibrary.getAssetsAsync({
      album: albumId,
      mediaType: ['photo', 'video', 'audio'],
      first: 2000,
      sortBy: ['creationTime'],
    });

    if (abortSignal?.aborted) return [];

    const files: ScannedFile[] = [];
    for (const asset of assets.assets) {
      if (abortSignal?.aborted) break;
      files.push({
        uri: asset.uri,
        fileName: asset.filename,
        size: 0,
        mimeType: asset.mediaType,
        modificationTime: asset.modificationTime || asset.creationTime,
        source: 'media',
        folderName: folderTitle,
        mediaAssetId: asset.id,
      });
    }

    return files;
  } catch (error) {
    console.error(`Error loading album ${albumId}:`, error);
    return [];
  }
}

export async function scanSAFDirectory(
  directoryUri: string,
  folderTitle?: string,
  abortSignal?: AbortSignal
): Promise<ScannedFile[]> {
  if (abortSignal?.aborted) return [];

  // Android Scoped Storage restriction: Virtual "Downloads" provider does not support child queries
  if (
    directoryUri.includes('com.android.providers.downloads.documents') ||
    directoryUri.includes('/tree/msd%3A') ||
    directoryUri.includes('/tree/raw%3A')
  ) {
    console.warn(
      `[SAF] Android virtual Downloads provider URI detected (${directoryUri}). Android restricts directory queries on this provider. Please select 'Internal Storage > Download' instead.`
    );
    return [];
  }

  try {
    const fileUris =
      await FileSystem.StorageAccessFramework.readDirectoryAsync(directoryUri);

    const files: ScannedFile[] = [];
    for (const fileUri of fileUris) {
      if (abortSignal?.aborted) break;
      const name = decodeURIComponent(fileUri.split('%2F').pop() || 'file');
      let size = 0;
      try {
        const info = await FileSystem.getInfoAsync(fileUri);
        // Fix 1.4: Skip sub-directories — only process actual files
        if (!info.exists || (info as any).isDirectory) continue;
        if (typeof (info as any).size === 'number') {
          size = (info as any).size;
        }
      } catch {}
      files.push({
        uri: fileUri,
        fileName: name,
        size,
        source: 'document',
        folderName: folderTitle,
      });
    }
    return files;
  } catch (error) {
    console.error(`Error reading SAF directory ${directoryUri}:`, error);
    return [];
  }
}

let isRequestingSAF = false;

export async function requestAndScanSAFDirectory(): Promise<{
  directoryUri: string;
  folderTitle: string;
  files: ScannedFile[];
} | null> {
  if (isRequestingSAF) {
    console.warn('[SAF] A directory permission request is already in progress');
    return null;
  }
  isRequestingSAF = true;
  try {
    const permissions =
      await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();

    if (!permissions.granted) {
      return null;
    }

    const directoryUri = permissions.directoryUri;

    // Detect Android virtual Downloads shortcut
    if (
      directoryUri.includes('com.android.providers.downloads.documents') ||
      directoryUri.includes('/tree/msd%3A') ||
      directoryUri.includes('/tree/raw%3A') ||
      directoryUri.endsWith('%3Adownloads')
    ) {
      Alert.alert(
        'Downloads Shortcut Restriction',
        'Android does not permit reading files from the virtual "Downloads" sidebar shortcut.\n\nTo scan your Downloads folder:\n1. Tap "Add Folder" again\n2. Open the sidebar (tap ☰ top-left)\n3. Tap your phone\'s "Internal Storage" (device name)\n4. Select the "Download" folder and tap "Use this folder".',
        [{ text: 'OK' }]
      );
      return null;
    }

    const cleanName = decodeURIComponent(
      directoryUri.split('%3A').pop() || directoryUri.split('%2F').pop() || 'Selected Folder'
    );
    const files = await scanSAFDirectory(directoryUri, cleanName);

    return { directoryUri, folderTitle: cleanName, files };
  } catch (error: any) {
    if (error?.message?.includes('unfinished permission request')) {
      console.warn('[SAF] Ignored duplicate unfinished permission request');
    } else {
      console.error('Error requesting SAF directory:', error);
    }
    return null;
  } finally {
    isRequestingSAF = false;
  }
}

export async function scanForNewFiles(options?: ScanOptions): Promise<ScannedFile[]> {
  const abortSignal = options?.abortSignal;
  if (abortSignal?.aborted) return [];

  const [uploaded, queue] = await Promise.all([
    getUploadedIndex(),
    getQueue().catch(() => []),
  ]);
  const uploadedUris = new Set(uploaded.map((u) => u.uri));
  const activeQueueUris = new Set(
    queue.filter((q) => q.status !== 'completed').map((q) => q.uri)
  );

  const targetFolders: WatchedFolder[] =
    options?.folders && options.folders.length > 0
      ? options.folders
      : await getWatchedFolders();

  const allFiles: ScannedFile[] = [];

  // Scoped scan: scan ONLY selected folders
  if (targetFolders.length > 0) {
    for (const folder of targetFolders) {
      if (abortSignal?.aborted) break;

      if (options?.onProgress) {
        options.onProgress(allFiles.length, folder.title);
      }

      if (folder.type === 'album') {
        const albumFiles = await getFilesFromAlbum(folder.id, folder.title, abortSignal);
        allFiles.push(...albumFiles);
      } else if (folder.type === 'saf') {
        const safFiles = await scanSAFDirectory(folder.id, folder.title, abortSignal);
        allFiles.push(...safFiles);
      }
    }
  }

  if (abortSignal?.aborted) return [];

  const config = await getConfig().catch(() => null);
  const excludedExts = new Set(
    (config?.excludedExtensions || ['nomedia', 'tmp', 'log', 'thumb', 'bak']).map((e) =>
      e.toLowerCase().replace(/^\./, '').trim()
    )
  );

  // Filter out already uploaded files, active queue files, and excluded extensions
  const candidateFiles = allFiles.filter((f) => {
    if (uploadedUris.has(f.uri) || activeQueueUris.has(f.uri)) return false;
    const ext = f.fileName.split('.').pop()?.toLowerCase() || '';
    if (ext && excludedExts.has(ext)) return false;
    if (f.fileName.startsWith('.') || f.fileName.toLowerCase() === 'thumbs.db') return false;
    return true;
  });

  if (abortSignal?.aborted) return [];

  // Populate file sizes efficiently and enforce min/max size thresholds
  const filesWithSize: ScannedFile[] = [];
  const minBytes = (config?.minFileSizeKb || 0) * 1024;
  const maxBytes = config?.maxFileSizeBytes || 0;

  for (const file of candidateFiles) {
    if (abortSignal?.aborted) break;
    try {
      const info = await getFileInfo(file.uri);
      const actualSize = info.size > 0 ? info.size : file.size || 0;

      // Filter by min size (e.g. skip icons/thumbnails smaller than threshold)
      if (minBytes > 0 && actualSize > 0 && actualSize < minBytes) {
        continue;
      }
      // Filter by max size (e.g. skip huge files larger than threshold)
      if (maxBytes > 0 && actualSize > maxBytes) {
        continue;
      }

      filesWithSize.push({
        ...file,
        size: actualSize,
      });
    } catch {
      filesWithSize.push(file);
    }
  }

  return filesWithSize;
}
