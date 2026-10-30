const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.resolver.extraNodeModules = {
  process: require.resolve('process/browser'),
  crypto: require.resolve('react-native-crypto'),
  stream: require.resolve('readable-stream'),
  buffer: require.resolve('buffer'),
  util: require.resolve('util'),
  os: path.resolve(__dirname, 'src/shims/os.js'),
  path: require.resolve('path-browserify'),
  events: require.resolve('events'),
  assert: require.resolve('assert'),
  fs: path.resolve(__dirname, 'src/shims/fs.js'),
  net: path.resolve(__dirname, 'src/shims/net.js'),
  tls: path.resolve(__dirname, 'src/shims/tls.js'),
  constants: path.resolve(__dirname, 'src/shims/empty.js'),
  http: path.resolve(__dirname, 'src/shims/empty.js'),
  https: path.resolve(__dirname, 'src/shims/empty.js'),
  zlib: path.resolve(__dirname, 'src/shims/empty.js'),
};

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'react-native-randombytes') {
    return context.resolveRequest(
      context,
      path.resolve(__dirname, 'src/shims/randombytes.js'),
      platform
    );
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
