# THRASH-PASS Windows updater

[Download THRASH-PASS-Updater.exe](https://github.com/Thrash-PRX/THRASH-PASS/releases/download/windows-updater-v1.1.0/THRASH-PASS-Updater.exe)

For Windows 10/11 with .NET Framework 4.5 or later. No Node.js, Python, or administrator access is required. This executable is unsigned; Windows may show a publisher warning. The complete source and build script are in this folder.

## Install once

1. Open the executable and click **Install / update and enable automatic checks**.
2. Click **Open extension folder**. The folder is `%LOCALAPPDATA%\THRASH-PASS\extension`.
3. Open `chrome://extensions` in Chrome. Enable **Developer mode**, click **Load unpacked**, and select that folder.

If the same folder is already loaded with extension 2.2.0 or earlier, click **Reload once** after 2.3.0 is installed. This activates automatic reload for future updates. Use Chrome/Chromium 116 or later.

If THRASH-PASS is already loaded from another folder, save your settings before switching. The new folder can create a separate extension installation, so you may need to enter your API key again. Remove the older duplicate when the new installation works.

## Automatic updates

The updater copies itself into `%LOCALAPPDATA%\THRASH-PASS` and creates a per-user Windows scheduled task named `THRASH-PASS Updates <your Windows SID>`. It runs every six hours while you are signed in. There is no always-running background service; missed checks retry at the next scheduled run or when you open the updater and click its install/update button. If task creation is blocked by Windows policy, the app displays the error; manual updates still work.

When `update.json` advertises a newer stable version, the helper downloads the official main-branch archive, extracts only the extension, validates its identity/version and required files, and replaces the installed folder. A Windows notification confirms the files have changed. Windows notification settings can suppress the balloon; `updater.log` records successful updates and failures.

Extension 2.3.0+ checks its packaged files every minute. After observing a complete newer build twice, it waits for active requests to finish and for the assistant panel and popup to close, then reloads itself and reconnects to open webpages. Unsaved webpage text and extension settings are retained; webpages are not refreshed. Chrome must be running with Developer mode enabled. Sleep and browser suspension can delay checks. The initial Chrome installation still requires Load unpacked, and older builds need one initial reload to activate the watcher. For browser-managed distribution without Developer mode, use the [Chrome Web Store](https://developer.chrome.com/docs/extensions/how-to/distribute).

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

The Windows workflow also runs `sandbox-test.ps1` in a disposable GitHub-hosted Windows VM. It installs the actual executable, verifies the task command and six-hour schedule, upgrades a simulated older build from GitHub, runs the task through Task Scheduler, and disables it. The script refuses to run outside the hosted VM. A separate isolated Chromium profile test verifies automatic extension reload, idle deferral, existing-page reconnection, saved settings, unsaved page text, and duplicate panel prevention. Test results and the updater log are included with the workflow artifact. Tests accelerate the next local watcher alarm rather than waiting for six hours; visible Windows notification delivery and live AI-provider requests are outside these tests.

For unattended setup, the executable supports `--install` (install files and enable scheduled checks) and `--disable-updates` (remove the scheduled task). Both return a nonzero exit code on failure and record errors in `updater.log`.
