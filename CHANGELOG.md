# Changelog

## Windows updater 1.0.1 — 2026-10-21

- Add unattended install/disable commands used to test the actual executable in a disposable Windows virtual machine.
- Verify fresh installation, executable copying, six-hour limited-privilege scheduling, background updates, previous-build backup, Task Scheduler execution, disabling, and cleanup.
- Retain the executable and test evidence in the Windows workflow artifact; document the test scope and Chrome reload requirement.

## Windows updater 1.0.0 — 2026-10-21

- Add a standalone Windows executable that installs the extension in a fixed per-user folder and schedules automatic file updates every six hours while signed in.
- Validate downloaded archive paths, extension identity, and advertised version before replacement; retain a previous build and restore it if activation fails.
- Notify when files are updated, document the Chrome reload step, and provide a button to disable scheduled checks.
- Include the complete C# source, repeatable Windows build, automated updater tests, and GitHub Actions build workflow. Extension runtime remains at 2.2.0.

## 2.2.0 — 2026-10-21

- Check the official repository for a newer version at browser startup and every six hours.
- Show a Chrome notification and **NEW** toolbar badge once for each newly detected version.
- Add a manual update check and direct update-guide link to the extension popup.
- Preserve the supplied 2.1.5 runtime fixes and document the safe manual update flow for unpacked extensions.

## 2.1.5 — 2026-10-14

- Integrate THRASH-PASS-v2.1.3-fixed.zip as the next release after 2.1.4.
- Replace fixed Gemini fallback IDs and 120-second fetch timeouts with account-based discovery and bounded 25-second requests.
- Add shared settings defaults, isolated provider profiles, and the popup Open assistant action.
- Apply Presentation Mode changes immediately; suppress duplicate requests and late answers, and stop auto-type when targets are cleared.
- Hide the overlay during capture, support custom vision endpoints, and improve selection restoration/editor error reporting.
- Refresh popup branding and display v2.1.5 in both popup and page assistant. Preserve artwork, storage keys, tutorial, and repository layout.


## 2.1.4

- Restored the preferred runtime build with longer request timeouts (120s), explicit Gemini 3 thinkingLevel=low, and the ordered hard-coded Flash fallback list that proved more reliable in practice.
- Retained resilient AI retries, editor insertion (Monaco / CodeMirror / Ace / contenteditable), and Presentation Mode.
- Updated package version to 2.1.4 across the installable extension.

## 2.1.3

- Automatically discover available general-purpose Gemini Flash alternatives after retryable failures.
- Show retry progress and the successful model in the page panel.
- Honor Retry-After, increase retry delays, and cap generation attempts at six within a 90-second recovery budget.
- Stop further page retries when Presentation Mode is enabled or provider credentials change.
- Preserve original icon bytes and existing saved settings.

## 2.1.2

- Separate installable extension from documentation and development tools.
- Refresh settings branding, labels, focus indicators, status announcements, and usage/privacy hints.
- Remove overlays and stop targeting when Presentation Mode is enabled; block new page AI requests in the worker.
- Check the requesting tab before screenshot capture; clearly reject unsupported screenshot providers.
- Reset unsaved key/endpoint and default model when changing providers.
- Exclude password, unsupported, disabled, and read-only fields from insertion.
- Prevent contenteditable fallback insertion outside the chosen destination.
- Handle popup action errors and avoid empty screenshot requests and duplicate submissions.
- Preserve existing configuration keys, provider adapters, Gemini retry/fallback behavior, and editor integrations.
- Add documentation, artwork, package checks, and regression tests.

### Original icon restoration

- Restored all four icon PNG files byte-for-byte from the uploaded archive, without resizing or recompression.
- Validate their SHA-256 hashes to prevent accidental artwork changes.
