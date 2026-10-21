# THRASH-PASS Windows updater

[Download THRASH-PASS-Updater.exe](https://github.com/Thrash-PRX/THRASH-PASS/releases/download/windows-updater-v1.0.0/THRASH-PASS-Updater.exe)

For Windows 10/11 with .NET Framework 4.5 or later. No Node.js, Python, or administrator access is required. This executable is unsigned; Windows may show a publisher warning. The complete source and build script are in this folder.

## Install once

1. Open the executable and click **Install / update and enable automatic checks**.
2. Click **Open extension folder**. The folder is `%LOCALAPPDATA%\THRASH-PASS\extension`.
3. Open `chrome://extensions` in Chrome. Enable **Developer mode**, click **Load unpacked**, and select that folder.

If THRASH-PASS is already loaded from another folder, save your settings before switching. The new folder can create a separate extension installation, so you may need to enter your API key again. Remove the older duplicate when the new installation works.

## Automatic updates

The updater copies itself into `%LOCALAPPDATA%\THRASH-PASS` and creates a per-user Windows scheduled task named `THRASH-PASS Updates <your Windows SID>`. It runs every six hours while you are signed in. There is no always-running background service; missed checks retry at the next scheduled run or when you open the updater and click its install/update button. If task creation is blocked by Windows policy, the app displays the error; manual updates still work.

When `update.json` advertises a newer stable version, the helper downloads the official main-branch archive, extracts only the extension, validates its identity/version and required files, and replaces the installed folder. A Windows notification reminds you to **click Reload on THRASH-PASS in `chrome://extensions`**. Windows notification settings can suppress the balloon; `updater.log` records successful updates and failures.

The helper updates extension files automatically. It cannot silently install an unpacked extension into Chrome or force Chrome to reload it. For browser-managed installation and updates on ordinary Windows Chrome installations, distribution through the [Chrome Web Store](https://developer.chrome.com/docs/extensions/how-to/distribute) is the supported route.

The current main branch is the distribution channel. Maintainers must update `update.json`, the extension manifest, and package version together in a complete, tested commit. If metadata and the downloaded archive disagree, the existing installation is kept and the next scheduled check retries. Network requests go only to fixed public GitHub URLs; API keys and browser profiles are never read. Download trust is based on HTTPS and repository control, not an independent package signature.

The previous build remains in `%LOCALAPPDATA%\THRASH-PASS\extension.previous`. The updater itself is updated manually by downloading a new executable.

## Disable or remove

Open the updater and click **Disable automatic checks** to remove its scheduled task. Files and settings are retained. To uninstall fully, remove the extension in Chrome, disable the scheduled task, close the updater, and delete `%LOCALAPPDATA%\THRASH-PASS`.

## Build and verify

From this repository on Windows:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File windows\build.ps1
windows\dist\UpdaterTests.exe --live-download
```

The build uses the Windows .NET Framework compiler and produces `windows/dist/THRASH-PASS-Updater.exe`. Tests cover version ordering, invalid metadata, archive traversal, extension-only extraction, mismatched versions, atomic replacement, and rollback. The optional live test downloads the current GitHub archive into a temporary directory without changing scheduled tasks or installed extension files. The original extension icons remain byte-for-byte unchanged; the executable uses a Windows-compatible icon derived at build time.
