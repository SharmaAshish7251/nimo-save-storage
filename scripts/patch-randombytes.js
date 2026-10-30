const fs = require('fs');
const path = require('path');

// 1. Patch react-native-randombytes
const rbTarget = path.resolve(__dirname, '../node_modules/react-native-randombytes/index.js');
if (fs.existsSync(rbTarget)) {
  let content = fs.readFileSync(rbTarget, 'utf8');
  if (content.includes("let RNRandomBytes = require('react-native').NativeModules.RNRandomBytes")) {
    content = content.replace(
      "let RNRandomBytes = require('react-native').NativeModules.RNRandomBytes",
      "let RNRandomBytes = (require('react-native').NativeModules && require('react-native').NativeModules.RNRandomBytes) || {}"
    );
    content = content.replace(
      "if (RNRandomBytes.seed)",
      "if (RNRandomBytes && RNRandomBytes.seed)"
    );
    fs.writeFileSync(rbTarget, content, 'utf8');
    console.log('Successfully patched react-native-randombytes');
  }
}

// 2. Patch readable-stream _stream_writable.js files
function patchWritable(dir) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== '.git') {
      patchWritable(fullPath);
    } else if (entry.isFile() && entry.name === '_stream_writable.js') {
      let content = fs.readFileSync(fullPath, 'utf8');
      if (content.includes("!process.browser && ['v0.10'")) {
        content = content.replace(
          "!process.browser && ['v0.10'",
          "!process.browser && process.version && ['v0.10'"
        );
        fs.writeFileSync(fullPath, content, 'utf8');
        console.log(`Successfully patched ${fullPath}`);
      }
    }
  }
}

patchWritable(path.resolve(__dirname, '../node_modules'));

// 3. Patch telegram PromisedWebSockets.js window.addEventListener
const pwsTarget = path.resolve(__dirname, '../node_modules/telegram/extensions/PromisedWebSockets.js');
if (fs.existsSync(pwsTarget)) {
  let content = fs.readFileSync(pwsTarget, 'utf8');
  if (content.includes('window.addEventListener("offline"')) {
    content = content.replace(
      'window.addEventListener("offline"',
      '(typeof window !== "undefined" && typeof window.addEventListener === "function") && window.addEventListener("offline"'
    );
    fs.writeFileSync(pwsTarget, content, 'utf8');
    console.log('Successfully patched telegram PromisedWebSockets.js');
  }
}

// 4. Patch telegram uploads.js to avoid reading file.path if buffer is present
const uploadsTarget = path.resolve(__dirname, '../node_modules/telegram/client/uploads.js');
if (fs.existsSync(uploadsTarget)) {
  let content = fs.readFileSync(uploadsTarget, 'utf8');
  if (content.includes('if (fileSize > maxBufferSize && file instanceof CustomFile)')) {
    content = content.replace(
      'if (fileSize > maxBufferSize && file instanceof CustomFile)',
      'if (fileSize > maxBufferSize && file instanceof CustomFile && file.path && !file.buffer)'
    );
    fs.writeFileSync(uploadsTarget, content, 'utf8');
    console.log('Successfully patched telegram uploads.js');
  }
}
