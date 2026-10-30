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
  readFile: (_p, cb) => cb && cb(null, ''),
  writeFile: (_p, _d, cb) => cb && cb(null),
  createReadStream: () => {},
  createWriteStream: () => {},
  WriteStream: class {},
  ReadStream: class {},
  promises: {
    lstat: async () => statMock,
    stat: async () => statMock,
    readFile: async () => Buffer.alloc(0),
    writeFile: async () => {},
    open: async () => ({
      read: async () => {},
      close: async () => {},
    }),
  },
};

