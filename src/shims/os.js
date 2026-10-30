const os = require('os-browserify/browser');

module.exports = {
  ...os,
  type: () => 'Android',
  release: () => '14.0.0',
  platform: () => 'android',
  arch: () => 'arm64',
  endianness: () => 'LE',
  hostname: () => 'localhost',
  homedir: () => '/data/user/0',
  tmpdir: () => '/data/local/tmp',
};

