/* global __dirname */
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

// 5. Patch react-native-tdlib react-native.config.js for Android autolinking on modern RN CLI
const tdlibConfig = path.resolve(__dirname, '../node_modules/react-native-tdlib/react-native.config.js');
if (fs.existsSync(tdlibConfig)) {
  const content = `module.exports = {
    dependency: {
        platforms: {
            ios: {},
            android: {
                packageImportPath: 'import com.reactnativetdlib.tdlibclient.TdLibPackage;',
                packageInstance: 'new TdLibPackage()',
            },
        },
    },
};
`;
  fs.writeFileSync(tdlibConfig, content, 'utf8');
  console.log('Successfully patched react-native-tdlib react-native.config.js');
}

// 6. Remove extraneous MainApplication.java from react-native-tdlib
const tdlibMainApp = path.resolve(__dirname, '../node_modules/react-native-tdlib/android/src/main/java/com/reactnativetdlib/MainApplication.java');
if (fs.existsSync(tdlibMainApp)) {
  fs.unlinkSync(tdlibMainApp);
  console.log('Successfully removed react-native-tdlib MainApplication.java');
}

// 6b. Patch react-native-tdlib index.js with dynamic Proxy to ensure proper binding and clear diagnostics
const tdlibIndex = path.resolve(__dirname, '../node_modules/react-native-tdlib/index.js');
if (fs.existsSync(tdlibIndex)) {
  const proxyCode = `import { NativeModules } from "react-native";

const TdLibProxy = new Proxy({}, {
  get(_target, prop) {
    const mod = NativeModules.TdLibModule;
    if (!mod) {
      return (..._args) => {
        throw new Error(
          \`[TdLibModule] Native method "\${String(prop)}" called, but TdLibModule is not linked.\\n\` +
          \`You are running in Expo Go or an APK without native TDLib.\\n\` +
          \`TDLib MTProto engine requires the custom Development Build APK (com.digitalgaruda.nimosavestorage).\`
        );
      };
    }
    const val = mod[prop];
    if (typeof val === 'function') {
      return val.bind(mod);
    }
    return val;
  }
});

export default TdLibProxy;
`;
  fs.writeFileSync(tdlibIndex, proxyCode, 'utf8');
  console.log('Successfully patched react-native-tdlib index.js with dynamic Proxy');
}

// 7. Patch react-native-reanimated build.gradle.kts to move buildStagingDirectory to D:/cxx/reanimated to avoid Windows MAX_PATH (>260 chars)
const reanimatedKts = path.resolve(__dirname, '../node_modules/react-native-reanimated/android/build.gradle.kts');
if (fs.existsSync(reanimatedKts)) {
  let ktsContent = fs.readFileSync(reanimatedKts, 'utf8');
  if (!ktsContent.includes('buildStagingDirectory = file("D:/cxx/reanimated")')) {
    ktsContent = ktsContent.replace(
      'path = file("CMakeLists.txt")',
      'path = file("CMakeLists.txt")\n            buildStagingDirectory = file("D:/cxx/reanimated")'
    );
    fs.writeFileSync(reanimatedKts, ktsContent, 'utf8');
    console.log('Successfully patched react-native-reanimated build.gradle.kts buildStagingDirectory');
  }
}

// 8. Patch react-native-gesture-handler CMakeLists.txt and shadow node headers for Windows MAX_PATH
const rnghCmake = path.resolve(__dirname, '../node_modules/react-native-gesture-handler/android/CMakeLists.txt');
const rnghSrcShadowDir = path.resolve(__dirname, '../node_modules/react-native-gesture-handler/shared/shadowNodes/react/renderer/components/rngesturehandler_codegen');
const rnghCodegenDir = path.resolve(__dirname, '../node_modules/react-native-gesture-handler/android/build/generated/source/codegen/jni/react/renderer/components/rngesturehandler_codegen');

if (fs.existsSync(rnghSrcShadowDir) && fs.existsSync(rnghCodegenDir)) {
  const files = fs.readdirSync(rnghSrcShadowDir);
  for (const f of files) {
    fs.copyFileSync(path.join(rnghSrcShadowDir, f), path.join(rnghCodegenDir, f));
  }
  console.log('Successfully copied gesture-handler shadowNodes to codegen jni');
}

if (fs.existsSync(rnghCmake)) {
  const cleanRnghCmake = `cmake_minimum_required(VERSION 3.13)
project(GestureHandlerCodegen)

set(CMAKE_VERBOSE_MAKEFILE on)
set(CMAKE_CXX_STANDARD 20)

file(GLOB_RECURSE rn_gesture_handler_codegen_SRCS CONFIGURE_DEPENDS ./build/generated/source/codegen/jni/*.cpp)

add_library(
  react_codegen_rngesturehandler_codegen
  SHARED
  \${rn_gesture_handler_codegen_SRCS}
)

if(ReactAndroid_VERSION_MINOR GREATER_EQUAL 80)
  target_compile_reactnative_options(react_codegen_rngesturehandler_codegen PRIVATE)
endif()

target_include_directories(react_codegen_rngesturehandler_codegen PUBLIC ./build/generated/source/codegen/jni)
target_include_directories(react_codegen_rngesturehandler_codegen PUBLIC ./build/generated/source/codegen/jni/react/renderer/components/rngesturehandler_codegen)

target_link_libraries(
  react_codegen_rngesturehandler_codegen
  fbjni
  jsi
  reactnative
)
`;
  fs.writeFileSync(rnghCmake, cleanRnghCmake, 'utf8');
  console.log('Successfully patched react-native-gesture-handler CMakeLists.txt');
}

// 9. Patch react-native-safe-area-context CMakeLists.txt and localized sources for Windows MAX_PATH
const sacJniDir = path.resolve(__dirname, '../node_modules/react-native-safe-area-context/android/src/main/jni');
const sacCommonDir = path.resolve(__dirname, '../node_modules/react-native-safe-area-context/common/cpp/react/renderer/components/safeareacontext');
const sacCodegenCompDir = path.resolve(__dirname, '../node_modules/react-native-safe-area-context/android/build/generated/source/codegen/jni/react/renderer/components/safeareacontext');
const sacCodegenJniDir = path.resolve(__dirname, '../node_modules/react-native-safe-area-context/android/build/generated/source/codegen/jni');

if (fs.existsSync(sacJniDir)) {
  const sacSrcDir = path.join(sacJniDir, 'src/react/renderer/components/safeareacontext');
  fs.mkdirSync(sacSrcDir, { recursive: true });

  if (fs.existsSync(sacCommonDir)) {
    for (const f of fs.readdirSync(sacCommonDir)) {
      fs.copyFileSync(path.join(sacCommonDir, f), path.join(sacSrcDir, f));
    }
  }
  if (fs.existsSync(sacCodegenCompDir)) {
    for (const f of fs.readdirSync(sacCodegenCompDir)) {
      fs.copyFileSync(path.join(sacCodegenCompDir, f), path.join(sacSrcDir, f));
    }
  }
  if (fs.existsSync(sacCodegenJniDir)) {
    for (const f of ['safeareacontext-generated.cpp', 'safeareacontext.h']) {
      const srcFile = path.join(sacCodegenJniDir, f);
      if (fs.existsSync(srcFile)) {
        fs.copyFileSync(srcFile, path.join(sacJniDir, 'src', f));
      }
    }
  }

  const sacCmake = path.join(sacJniDir, 'CMakeLists.txt');
  const cleanSacCmake = `cmake_minimum_required(VERSION 3.13)
set(CMAKE_VERBOSE_MAKEFILE ON)

set(LIB_LITERAL safeareacontext)
set(LIB_TARGET_NAME react_codegen_\${LIB_LITERAL})

file(GLOB LIB_SRCS CONFIGURE_DEPENDS src/*.cpp src/react/renderer/components/safeareacontext/*.cpp)

add_library(
  \${LIB_TARGET_NAME}
  SHARED
  \${LIB_SRCS}
)

target_include_directories(
  \${LIB_TARGET_NAME}
  PUBLIC
  .
  src
  src/react/renderer/components/safeareacontext
)

if (REACTNATIVE_MERGED_SO)
  target_link_libraries(
          \${LIB_TARGET_NAME}
          fbjni
          jsi
          reactnative
  )
else()
  target_link_libraries(
          \${LIB_TARGET_NAME}
          fbjni
          folly_runtime
          glog
          jsi
          react_codegen_rncore
          react_debug
          react_nativemodule_core
          react_render_core
          react_render_debug
          react_render_graphics
          react_render_mapbuffer
          react_render_componentregistry
          react_utils
          rrc_view
          turbomodulejsijni
          yoga
  )
endif()

target_include_directories(
  \${CMAKE_PROJECT_NAME}
  PUBLIC
  \${CMAKE_CURRENT_SOURCE_DIR}
)

if(ReactAndroid_VERSION_MINOR GREATER_EQUAL 80)
  target_compile_reactnative_options(\${LIB_TARGET_NAME} PUBLIC)
else()
  target_compile_options(
    \${LIB_TARGET_NAME}
    PRIVATE
    -fexceptions
    -frtti
    -std=c++20
    -Wall
  )
endif()

target_compile_options(
  \${LIB_TARGET_NAME}
  PRIVATE
  -Wpedantic
  -Wno-gnu-zero-variadic-macro-arguments
  -Wno-dollar-in-identifier-extension
)
`;
  fs.writeFileSync(sacCmake, cleanSacCmake, 'utf8');
  console.log('Successfully patched react-native-safe-area-context CMakeLists.txt and sources');
}

// 7. Patch TdLibModule.java for startTdLib parameter handling
const tdlibModuleJava = path.resolve(__dirname, '../node_modules/react-native-tdlib/android/src/main/java/com/reactnativetdlib/tdlibclient/TdLibModule.java');
if (fs.existsSync(tdlibModuleJava)) {
  let content = fs.readFileSync(tdlibModuleJava, 'utf8');
  const target = `            if (client != null) {
                promise.resolve("TDLib already started");
                return;
            }`;
  const replacement = `            if (client != null) {
                client.send(new TdApi.GetAuthorizationState(), object -> {
                    if (object instanceof TdApi.AuthorizationStateWaitTdlibParameters) {
                        setTdLibParameters(parameters, promise);
                    } else {
                        promise.resolve("TDLib already started");
                    }
                });
                return;
            }`;
  if (content.includes(target)) {
    content = content.replace(target, replacement);
    fs.writeFileSync(tdlibModuleJava, content, 'utf8');
    console.log('Successfully patched TdLibModule.java for startTdLib parameter handling');
  }
}

