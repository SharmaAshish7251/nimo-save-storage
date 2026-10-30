module.exports = {
  existsSync: () => false,
  lstatSync: () => ({ isDirectory: () => false }),
  statSync: () => ({ size: 0 }),
  readFileSync: () => '',
  writeFileSync: () => {},
  readFile: (_p, cb) => cb && cb(null, ''),
  writeFile: (_p, _d, cb) => cb && cb(null),
  createReadStream: () => {},
  createWriteStream: () => {},
  WriteStream: class {},
  ReadStream: class {},
  promises: {
    readFile: async () => '',
    writeFile: async () => {},
  },
};

