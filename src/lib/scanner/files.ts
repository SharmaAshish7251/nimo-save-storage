import { appAlert } from '@/components/AppAlert';
import * as MediaLibrary from 'expo-media-library/legacy';
import * as FileSystem from 'expo-file-system/legacy';
import * as DocumentPicker from 'expo-document-picker';
import PQueue from 'p-queue';
import { getUploadedIndex, getWatchedFolders, getQueue, getConfig, WatchedFolder } from '../storage/queue';
import { getFileInfo, getFileCategory, inferMimeType, resolveLocalFileTarget } from '../storage/fileHelper';

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
    const files: ScannedFile[] = [];
    let hasNextPage = true;
    let endCursor: string | undefined = undefined;
    const MAX_FOLDER_FILES = 10000;
    const sampleAssets: MediaLibrary.Asset[] = [];

    while (hasNextPage && files.length < MAX_FOLDER_FILES && !abortSignal?.aborted) {
      const page = await MediaLibrary.getAssetsAsync({
        album: albumId,
        mediaType: ['photo', 'video', 'audio'],
        first: 1000,
        after: endCursor,
        sortBy: ['creationTime'],
      });

      for (const asset of page.assets) {
        if (abortSignal?.aborted) break;
        if (sampleAssets.length < 5) {
          sampleAssets.push(asset);
        }
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

      hasNextPage = page.hasNextPage;
      endCursor = page.endCursor;
      if (!endCursor) break;
    }

    if (abortSignal?.aborted) return files;

    // Scan physical folder directory for all file types (documents, archives, custom user extensions)
    let resolvedDirUri: string | null = null;

    // 1. Try resolving physical directory URI from sample assets in this album
    for (const asset of sampleAssets) {
      let fileUri = asset.uri;
      if (!fileUri.startsWith('file://')) {
        try {
          const assetInfo = await MediaLibrary.getAssetInfoAsync(asset.id).catch(() => null);
          if (assetInfo?.localUri && assetInfo.localUri.startsWith('file://')) {
            fileUri = assetInfo.localUri;
          }
        } catch {}
      }
      if (fileUri.startsWith('file://')) {
        const cleanUri = fileUri.split('?')[0];
        const lastSlash = cleanUri.lastIndexOf('/');
        if (lastSlash > 7) {
          resolvedDirUri = cleanUri.substring(0, lastSlash);
          break;
        }
      }
    }

    // 2. Fallback: try common device directory paths matching folderTitle
    if (!resolvedDirUri && folderTitle) {
      const candidateDirs = [
        `file:///storage/emulated/0/${folderTitle}`,
        `file:///storage/emulated/0/Download/${folderTitle}`,
        `file:///storage/emulated/0/Documents/${folderTitle}`,
        `file:///storage/emulated/0/DCIM/${folderTitle}`,
        `file:///storage/emulated/0/Pictures/${folderTitle}`,
        `file:///storage/emulated/0/Movies/${folderTitle}`,
        `file:///storage/emulated/0/Music/${folderTitle}`,
      ];
      for (const cand of candidateDirs) {
        try {
          const info = await FileSystem.getInfoAsync(cand);
          if (info.exists && (info as any).isDirectory) {
            resolvedDirUri = cand;
            break;
          }
        } catch {}
      }
    }

    // 3. If directory resolved, read all entries and add any non-media / document / custom files
    if (resolvedDirUri) {
      try {
        const dirEntries = await FileSystem.readDirectoryAsync(resolvedDirUri);
        const existingNames = new Set(files.map((f) => f.fileName.toLowerCase()));

        for (const entry of dirEntries) {
          if (abortSignal?.aborted) break;
          if (existingNames.has(entry.toLowerCase())) continue;
          if (entry.startsWith('.') || entry.toLowerCase() === 'thumbs.db') continue;

          const fullFileUri = `${resolvedDirUri}/${entry}`;
          try {
            const info = await FileSystem.getInfoAsync(fullFileUri);
            if (!info.exists || (info as any).isDirectory) continue;

            const ext = entry.split('.').pop()?.toLowerCase() || '';
            const mimeType = inferMimeType(ext) || 'application/octet-stream';

            files.push({
              uri: fullFileUri,
              fileName: entry,
              size: (info as any).size || 0,
              mimeType,
              modificationTime: (info as any).modificationTime
                ? (info as any).modificationTime * 1000
                : undefined,
              source: 'document',
              folderName: folderTitle,
            });
          } catch {}
        }
      } catch (fsErr) {
        console.warn(`[getFilesFromAlbum] Direct directory scan of ${resolvedDirUri} failed or restricted:`, fsErr);
      }
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
    const pQueue = new PQueue({ concurrency: 12 });

    const tasks = fileUris.map((fileUri) =>
      pQueue.add(async () => {
        if (abortSignal?.aborted) return;
        const name = decodeURIComponent(fileUri.split('%2F').pop() || 'file');
        let size = 0;
        try {
          const info = await FileSystem.getInfoAsync(fileUri);
          // Skip sub-directories — only process actual files
          if (!info.exists || (info as any).isDirectory) return;
          if (typeof (info as any).size === 'number') {
            size = (info as any).size;
          }
        } catch {
          return;
        }

        const ext = name.split('.').pop()?.toLowerCase() || '';
        const mimeType = inferMimeType(ext);

        files.push({
          uri: fileUri,
          fileName: name,
          size,
          mimeType,
          source: 'document',
          folderName: folderTitle,
        });
      })
    );

    await Promise.all(tasks);
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
      appAlert(
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
  const customExts = new Set(
    (config?.customFileTypes || []).map((c) => c.extension.toLowerCase().replace(/^\./, '').trim())
  );
  const excludedExts = new Set(
    (config?.excludedExtensions || ['nomedia', 'tmp', 'log', 'thumb', 'bak']).map((e) =>
      e.toLowerCase().replace(/^\./, '').trim()
    )
  );

  // Filter out already uploaded files, active queue files, and excluded extensions
  const candidateFiles = allFiles.filter((f) => {
    if (uploadedUris.has(f.uri) || activeQueueUris.has(f.uri)) return false;
    const ext = f.fileName.split('.').pop()?.toLowerCase() || '';
    if (ext && excludedExts.has(ext) && !customExts.has(ext)) return false;
    if (f.fileName.startsWith('.') || f.fileName.toLowerCase() === 'thumbs.db') return false;
    return true;
  });

  if (abortSignal?.aborted) return [];

  // Populate file sizes efficiently and enforce min/max size thresholds
  const filesWithSize: ScannedFile[] = [];
  const minBytes = (config?.minFileSizeKb || 0) * 1024;
  const maxBytes = config?.maxFileSizeBytes || 0;

  const sizeQueue = new PQueue({ concurrency: 12 });
  const sizeTasks = candidateFiles.map((file) =>
    sizeQueue.add(async () => {
      if (abortSignal?.aborted) return;
      let actualSize = file.size || 0;
      if (actualSize <= 0) {
        try {
          const info = await getFileInfo(file.uri);
          if (info.size > 0) {
            actualSize = info.size;
          }
        } catch {}
      }

      // Filter by min size (e.g. skip icons/thumbnails smaller than threshold)
      if (minBytes > 0 && actualSize > 0 && actualSize < minBytes) {
        return;
      }
      // Filter by max size (e.g. skip huge files larger than threshold)
      if (maxBytes > 0 && actualSize > maxBytes) {
        return;
      }

      filesWithSize.push({
        ...file,
        size: actualSize,
      });
    })
  );

  await Promise.all(sizeTasks);

  return filesWithSize;
}
