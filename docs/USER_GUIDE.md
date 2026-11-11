# Nimo Save Storage — User Guide

Welcome to **Nimo Save Storage**! This guide explains how to configure and use Nimo to turn your Telegram account into an unlimited, automated private cloud vault for all your mobile media.

---

## 🚀 Quick Start Guide

### Step 1: Connect Your Telegram Account
1. Open the app and complete the welcome wizard or navigate to **Connect Telegram**.
2. Enter your phone number with international country code (e.g. `+1...`, `+91...`).
3. Telegram will send an official login code to your Telegram app (or via SMS). Enter the code.
4. If you have Two-Step Verification (2FA Cloud Password) enabled, enter your password.
5. Your credentials stay strictly on your device in hardware-encrypted secure storage.

---

### Step 2: Choose Your Cloud Destination
In **Settings** -> **Telegram Destination**:
* **Saved Messages (`me`)** *(Recommended)*: Media is stored directly in your private Telegram "Saved Messages" chat. Only you have access to it.
* **Custom Channel or Group**: You can specify a private channel ID (e.g. `-100123456789`) where you are an administrator. This is useful for separating personal backups from family or project vaults.

---

### Step 3: Add Watched Folders
1. Open the **Upload Queue** screen (`/upload`).
2. Tap **Watched Folders** or **Add Folder**.
3. Use the Android system folder picker to grant permission for directories you want automatically backed up:
   * `DCIM/Camera` (camera photos and recorded videos)
   * `Pictures` (saved images, screenshots)
   * `Download` (downloaded documents, ZIPs, PDFs)
   * Custom app folders (e.g. WhatsApp Media)
4. Any newly taken photo or downloaded file will be detected automatically!

---

## ⚙️ Automated Scheduling & Night Window

Nimo is built to run autonomously in the background without draining your daytime battery or data plan.

### Selecting a Schedule Mode (`Settings` -> `Auto Upload Scheduler`)

#### 1. Interval Frequency
* Checks your watched folders periodically (e.g. every **5 minutes**, **15 minutes**, or **1 hour**).
* Ideal if you take photos throughout the day and want them backed up promptly.

#### 2. Night Window (Sleep Sync)
* Restricts automatic backups to a specific daily time window (e.g. `22:00` to `06:00`).
* **Live Status Indicator**: Tells you if the window is currently active or sleeping.
* **Overnight Spans**: Supports windows that cross midnight (e.g. starting at 10 PM and finishing at 6 AM).
* **Clock Dialer**: Tap either time card to adjust the start/end time using the Material clock dialer or quick pick buttons.
* **Presets**: 1-tap presets for *Sleep Window*, *Night Owl*, *Evening Sync*, or *All Day*.

#### 3. Continuous Live Sync
* Monitors local storage events and triggers an upload immediately when a new photo is saved while the app is active.

---

### Hardware & Power Guards

* 🔋 **Battery Guard**: Automatically pauses uploads if your device battery drops below 15%, 20%, or 30%.
* ⚡ **Only When Charging**: Restricts all automated backups to times when your phone is plugged into power (AC or USB). Combine this with the **Night Window** for effortless zero-drain backups while you sleep!
* 📶 **WiFi Only**: Ensures large video files and backups never consume cellular data.

---

## 🖼️ Browsing & Managing Media (Cloud Explorer)

Access the **Cloud Explorer** (`/explore`) from the Dashboard:
* **Switch Views**: Toggle between the **3-column photo grid** and the **detailed list view**.
* **Filter by Category**: Tap chips for `Photos`, `Videos`, `Audio`, or `Documents`.
* **Missing in Cloud Chip**: Filter files that were deleted from Telegram so you can either re-upload them or remove the stale record.
* **Multi-Part Split Files**: Files larger than 1.95 GB display a purple `SPLIT: N parts` badge.
* **Sharing**: Tap any file to view details and use the system share sheet to send it to messaging or editing apps.
* **Two-Way Deletion**: When deleting a file, choose to remove the record locally or delete the original message from Telegram servers.
* **Import from Telegram**: Tap the cloud-download icon in the top right to scan and index files uploaded to your Saved Messages from your PC or web browser.

---

## 🧹 Freeing Up Device Space

When your phone's storage is running low:
1. Tap **Free Up Space** on the Dashboard or in Settings.
2. Nimo analyzes your storage and displays files that are **safely preserved in Telegram Cloud**.
3. **Safety Shield Verification**: Before any local file is deleted, Nimo verifies with Telegram that the remote backup is intact. If a file was deleted from Telegram, Nimo blocks its local deletion to protect your data.
4. Review the files and tap **Clean Local Files** to reclaim storage!

---

## 🔒 Biometric Security

Keep your private cloud vault protected from unauthorized physical access:
1. Go to **Settings** -> **Security & Privacy**.
2. Enable **Biometric App Lock**.
3. Whenever the app is opened or brought to the foreground, it will require your Fingerprint, Face ID, or device PIN.

---

## ❓ Frequently Asked Questions (FAQ)

### Is Telegram cloud storage truly unlimited?
Yes! Telegram allows users to upload an unlimited number of files to their Saved Messages or private channels. Standard Telegram accounts support individual files up to 1.95 GB (which Nimo automatically chunks for larger files), while Telegram Premium accounts support individual files up to 4 GB.

### Will my media lose quality?
No. Nimo uploads all photos, videos, and files as raw documents (`sendDocument`), preserving 100% of the original resolution, bit-rate, color profiles, and EXIF metadata.

### What if I delete a photo from my phone?
If the photo was already uploaded, it remains safely in your Telegram cloud. You can browse, view, and share it anytime via Nimo's Cloud Explorer.
