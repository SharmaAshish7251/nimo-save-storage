const { Buffer } = require('buffer');

function randomBytes(length, cb) {
  const buf = Buffer.allocUnsafe(length);
  const cryptoObj =
    (typeof globalThis !== 'undefined' && globalThis.crypto) ||
    (typeof crypto !== 'undefined' ? crypto : null) ||
    (typeof window !== 'undefined' && window.crypto ? window.crypto : null);

  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    cryptoObj.getRandomValues(buf);
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
