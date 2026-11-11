# Nimo Save Storage 🚀

[![Expo](https://img.shields.io/badge/Expo-SDK_58-blue.svg?logo=expo)](https://expo.dev)
[![React Native](https://img.shields.io/badge/React_Native-0.88-61DAFB.svg?logo=react)](https://reactnative.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-blue.svg?logo=typescript)](https://www.typescriptlang.org/)
[![Telegram TDLib](https://img.shields.io/badge/Telegram-Official_TDLib_MTProto-2CA5E0.svg?logo=telegram)](https://core.telegram.org/tdlib)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

> **Zero-cost, private, unlimited cloud storage for Android powered directly by Telegram's official TDLib MTProto protocol.**

Nimo Save Storage turns your personal Telegram into an autonomous, bit-for-bit cloud backup vault. Upload photos, 4K videos, documents, and large files up to 4GB+ without lossy compression, monthly subscriptions, or third-party servers.

---

## 🌟 Key Features

### 🏛️ Official MTProto Protocol (Direct TDLib)
* Connects directly to Telegram's Data Centers using official TDLib native bindings (`react-native-tdlib`).
* **Zero Intermediaries**: Your credentials and file streams never touch any proxy, bot server, or middleman.
* Back up directly to your personal **Saved Messages** (`me`) or route into any custom private channel or group.

### 🧩 Multi-Part Chunking Engine (>1.95 GB to 4 GB+)
* Automatically splits files larger than 1.95 GB into sequential streaming parts (`.part001`, `.part002`).
* 16 MB low-footprint streaming buffer prevents memory spikes and out-of-memory crashes on mobile devices.
* Cryptographic manifest tracking with on-demand transparent reassembly when restoring or sharing files.

### ☁️ Cloud Explorer & Media Gallery
* **Dual Display Modes**: Switch between 3-column media grid (with fast image thumbnails) and detailed file metadata lists.
* **Instant Filtering & Sorting**: Filter by Photos, Videos, Audio, Documents, and Missing Cloud items; sort by date, size, or name.
* **Reverse Cloud Discovery**: Scan and index files previously uploaded to Saved Messages from PC or web clients.
* **Two-Way Deletion & Real-Time Sync**: Automatically synchronizes when files are removed in Telegram and allows remote deletion straight from the app.

### 🛡️ Safety Shield Device Cleaner ("Free Up Space")
* Identifies local photos and videos that are already verified and backed up on Telegram.
* **Safety Shield Verification**: Probes Telegram's servers before local deletion to verify remote message availability, blocking local deletion if the cloud copy was deleted.

### ⏰ Intelligent Auto-Scheduler & Night Window
* **3 Schedule Modes**:
  * **Interval**: Periodic automatic scans (1m to 6h).
  * **Night Window (Sleep Sync)**: Overnight window with midnight-spanning support, live status indicator, and interactive time bridge.
  * **Continuous Live Sync**: Instant reactive upload when new photos or media are saved.
* **Hardware & Battery Guards**:
  * **Battery Guard**: Pauses scans when battery drops below 15%, 20%, or 30%.
  * **Only When Charging**: Restricts automated backups to AC/USB power.
  * **WiFi Only**: Ensures cellular data is never consumed for uploads.

### 🔒 Biometric Privacy & System Logs
* **Hardware Biometrics**: Lock app entry with Fingerprint, Face ID, or system PIN via `expo-local-authentication`.
* **In-App Diagnostic Logs**: Live console capture, severity filtering (`LOG`, `WARN`, `ERR`), and one-tap log export.

---

## 📂 Project Structure

```
nimo-save-storage/
├── assets/                    # App icons, logos, and static graphics
├── docs/                      # Technical and user documentation
│   ├── ARCHITECTURE.md        # Deep-dive system architecture & data flow
│   └── USER_GUIDE.md           # End-user setup and best practices guide
├── src/
│   ├── app/                   # Expo Router screens & navigation routes
│   │   ├── _layout.tsx        # Root layout, splash, biometric gate, lifecycle
│   │   ├── index.tsx          # Home dashboard & system health overview
│   │   ├── explore.tsx        # Cloud media explorer & gallery
│   │   ├── upload.tsx         # Upload queue, history & folder scanner
│   │   ├── settings.tsx       # Scheduler, Night Window, battery guard, routing
│   │   ├── telegram-login.tsx # Phone auth & 2FA login screen
│   │   ├── onboarding.tsx     # 4-step first-run onboarding wizard
│   │   └── logs.tsx           # Real-time console diagnostics & log export
│   ├── components/            # Reusable UI modules & modals
│   │   ├── BiometricLockOverlay.tsx
│   │   ├── DestinationSelector.tsx
│   │   ├── FreeUpSpaceModal.tsx
│   │   ├── FolderBrowserModal.tsx
│   │   ├── TimeDialerModal.tsx
│   │   └── FileDetailsModal.tsx
│   ├── lib/                   # Core business logic & storage engines
│   │   ├── tdlib/             # TDLib client, message verification & MTProto calls
│   │   ├── upload/            # Upload manager, queue worker pool & chunker
│   │   ├── storage/           # Queue persistence, cleaner, cloudSync & secure
│   │   ├── scheduler/         # Automated background scheduler engine
│   │   └── scanner/           # Storage Access Framework (SAF) folder scanner
│   └── tasks/                 # Background task worker (expo-background-task)
└── app.json                   # Expo configuration & native plugin declarations
```

---

## 🚀 Getting Started

### Prerequisites
* **Node.js** (v18 or v20 LTS recommended)
* **npm** or **bun**
* **Android Studio & SDK** (for local development build)
* **Telegram API ID & Hash** (from [my.telegram.org](https://my.telegram.org))

### 1. Clone & Install Dependencies
```bash
git clone https://github.com/SharmaAshish7251/nimo-save-storage.git
cd nimo-save-storage
npm install
```

### 2. Configure Telegram Credentials
Obtain your `API_ID` and `API_HASH` from [my.telegram.org](https://my.telegram.org) and set them in your environment or app configuration.

### 3. Native Development Build
Because this project utilizes official native C++ TDLib binaries (`react-native-tdlib`), standard Expo Go cannot run the custom native module. Run a local development build:

```bash
# Generate native Android project and run on connected device/emulator
npx expo run:android
```

Or build an APK/AAB via EAS:
```bash
npx eas-cli build --platform android --profile development
```

### 4. Code Quality & Diagnostics
```bash
# TypeScript typecheck
npx tsc --noEmit

# Lint check
npx expo lint

# Diagnose dependency compatibility
npx expo-doctor
```

---

## 📖 Detailed Documentation

* 📐 **[Technical Architecture & Data Flow](docs/ARCHITECTURE.md)**: Details on the TDLib MTProto client, chunking manifests, two-way sync protocol, safety shield verification, and background state machines.
* 📱 **[End-User Guide & FAQ](docs/USER_GUIDE.md)**: Step-by-step instructions for connecting Telegram, choosing destinations, setting up Watched Folders, configuring the Night Window, and freeing up space.

---

## 📄 License
This project is licensed under the [MIT License](LICENSE).
