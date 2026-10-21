# Validation and limitations

Run `npm test` with Node.js 20+. No external packages or API credentials are needed.

## 2.3.0 verification

The 16 repository tests cover existing behavior plus complete-file detection, two-observation reload gating, open-panel/popup deferral, and waiting for active AI work. The optional `npm run test:browser` uses Playwright 1.64.1 with a temporary extension copy and disposable Chromium profile. It changes the copied extension's version, triggers a real Chrome alarm, and verifies the actual runtime reload, saved settings, unsaved webpage text, no page refresh, and one working assistant after reconnection. It also verifies that an open draft blocks reload. No user's browser profile, API key, or installed extension is used.

Install the optional tools with `npm install --no-save --package-lock=false playwright@1.64.1` and `npx playwright install chromium`. Browser results are written to `output/playwright/auto-reload-results.json`. The Windows workflow runs both suites plus the native updater tests in a disposable VM. Initial Developer mode/Load unpacked setup is required; automatic reload begins only after 2.3.0+ is loaded.

## 2.2.0 verification — 21 October 2026

Package validation and all 12 repository regression tests pass. Checks include synchronized version metadata, update permissions, update version comparison, one notification per newer version, provider adapters, Presentation Mode, screenshots, insertion targeting, Gemini recovery, and original icon integrity. The supplied 2.1.5 runtime fixes remain in place.

## 2.1.5 verification — 14 October 2026

Package validation and all 11 repository regression tests passed. Checks cover manifest references, shared settings/JavaScript syntax, version consistency, popup assets, original icon SHA-256 integrity, provider payload adapters, account-based Gemini discovery and bounded fallback, authentication failure handling, Presentation Mode gates, screenshot target checks, invalid endpoints, missing keys, sensitive input exclusion, and switching/restoring provider profiles.

Browser and provider APIs in the repository tests are mocked. No live provider credentials were used. This does not certify live model access, provider billing/quotas, arbitrary third-party editors, or every browser version.

The supplied ZIP also included a historical 37-check report, retained in [SUPPLIED-BUILD-TEST-RESULTS.md](SUPPLIED-BUILD-TEST-RESULTS.md). Those checks have not all been rerun for this release.

## Manual release checklist

1. Load extension/ unpacked and check the extension error panel.
2. Configure available providers, test connection, and refresh Gemini models.
3. Open via popup, menus, and shortcut on an ordinary webpage.
4. Exercise real screenshots and supported editors, including frames.
5. Toggle Presentation Mode during a request and auto-type; verify immediate suppression and stop behavior.
6. Check intended Chrome/Edge versions and sites.

The extension cannot recall already-sent provider requests. Site editor APIs may be inaccessible or reject programmatic edits; use Copy/manual paste in those cases. Page text and screenshots may contain private information. Browser-internal and extension-store pages restrict injection.
