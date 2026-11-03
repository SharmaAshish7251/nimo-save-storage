const { Buffer } = require('buffer');

function randomBytes(length, cb) {
  const buf = Buffer.allocUnsafe(length);
  
  try {
    require('react-native-get-random-values');
  } catch (e) {}
  
  const cryptoObj =
    (typeof globalThis !== 'undefined' && globalThis.crypto) ||
    (typeof global !== 'undefined' && global.crypto) ||
    (typeof crypto !== 'undefined' ? crypto : null) ||
    (typeof window !== 'undefined' && window.crypto ? window.crypto : null);

  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    try {
      cryptoObj.getRandomValues(buf);
    } catch (e) {
      for (let i = 0; i < length; i++) {
        buf[i] = Math.floor(Math.random() * 256);
      }
    }
  } else {
    for (let i = 0; i < length; i++) {
      buf[i] = Math.floor(Math.random() * 256);
    }
  }

  if (typeof cb === 'function') {
    if (typeof process !== 'undefined' && process.nextTick) {
      process.nextTick(() => cb(null, buf));
    } else {
      setTimeout(() => cb(null, buf), 0);
    }
    return;
  }
  return buf;
}

const seedSJCL = (cb) => {
  if (typeof cb === 'function') cb(null);
};

module.exports = {
  randomBytes,
  seedSJCL,
  default: {
    randomBytes,
    seedSJCL,
  },
};
