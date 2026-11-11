/**
 * fs shim for React Native / Expo
 *
 * Provides enough of the Node.js `fs` API for GramJS to do path-based
 * parallel streaming uploads (workers: N) for files > 20 MB.
 *
 * Key methods implemented:
 *   promises.stat(path)      → returns { size, isFile(), ... }
 *   promises.lstat(path)     → same as stat
 *   promises.open(path, 'r') → returns a fake file handle with real read()
 *   promises.readFile(path)  → reads entire file as Buffer
 *
 * We use expo-file-system/legacy (LegacyFileSystem) for actual I/O because
 * the new Expo File API doesn't expose random-access reads.
 *
 * NOTE: `path` values coming from GramJS will be local filesystem paths
 * (e.g. /data/user/0/com.xxx/cache/nimo_upload/xxx.jpg), not content:// URIs.
 */

const { Buffer } = require('buffer');

// Lazily require expo-file-system to avoid circular dependency at module load
function getFS() {
  try {
    return require('expo-file-system/legacy');
  } catch (_e) {
    return null;
  }
}

function toFileUri(filePath) {
  if (!filePath) return '';
  if (filePath.startsWith('file://')) return filePath;
  return 'file://' + filePath;
}

async function readBase64(filePath) {
  const FS = getFS();
  if (!FS) return '';
  try {
    return await FS.readAsStringAsync(toFileUri(filePath), {
      encoding: 'base64',
    });
  } catch {
    return '';
  }
}

async function getFileStat(filePath) {
  const FS = getFS();
  if (!FS) return { size: 0, isFile: () => true };
  try {
    const info = await FS.getInfoAsync(toFileUri(filePath));
    const size = (info.exists && info.size) ? info.size : 0;
    return {
      size,
      isFile: () => !info.isDirectory,
      isDirectory: () => !!info.isDirectory,
      isBlockDevice: () => false,
      isCharacterDevice: () => false,
      isSymbolicLink: () => false,
      isFIFO: () => false,
      isSocket: () => false,
    };
  } catch {
    return {
      size: 0,
      isFile: () => true,
      isDirectory: () => false,
      isBlockDevice: () => false,
      isCharacterDevice: () => false,
      isSymbolicLink: () => false,
      isFIFO: () => false,
      isSocket: () => false,
    };
  }
}

/**
 * Creates a fake file handle that supports random-access reads via Base64.
 * GramJS calls: fHandle.read(buffer, offset, length, position)
 *
 * We eagerly load the entire file as Base64 on first read, cache it, then
 * slice the requested byte range. This avoids repeated full-file reads per
 * chunk while still allowing GramJS workers to slice in parallel.
 */
function createFileHandle(filePath) {
  let cachedBuffer = null;

  async function ensureLoaded() {
    if (cachedBuffer) return cachedBuffer;
    const b64 = await readBase64(filePath);
    cachedBuffer = Buffer.from(b64, 'base64');
    return cachedBuffer;
  }

  return {
    async read(outBuffer, outOffset, length, position) {
      const fileBuffer = await ensureLoaded();
      const end = Math.min(position + length, fileBuffer.length);
      const slice = fileBuffer.slice(position, end);
      slice.copy(outBuffer, outOffset);
      return { bytesRead: slice.length, buffer: outBuffer };
    },
    async close() {
      // Release cache when GramJS closes the handle
      cachedBuffer = null;
    },
  };
}

const statMock = {
  isFile: () => true,
  isDirectory: () => false,
  isBlockDevice: () => false,
  isCharacterDevice: () => false,
  isSymbolicLink: () => false,
  isFIFO: () => false,
  isSocket: () => false,
  size: 0,
};

module.exports = {
  existsSync: () => false,
  lstatSync: () => statMock,
  statSync: () => statMock,
  readFileSync: () => '',
  writeFileSync: () => {},
  readFile: (_p, cb) => cb && cb(null, Buffer.alloc(0)),
  writeFile: (_p, _d, cb) => cb && cb(null),
  createReadStream: () => ({}),
  createWriteStream: () => ({}),
  WriteStream: class {},
  ReadStream: class {},
  promises: {
    lstat: (filePath) => getFileStat(filePath),
    stat: (filePath) => getFileStat(filePath),
    readFile: async (filePath) => {
      const b64 = await readBase64(filePath);
      return Buffer.from(b64, 'base64');
    },
    writeFile: async () => {},
    open: async (filePath, _mode) => createFileHandle(filePath),
  },
};
