# Validation and limitations

Run `npm test` with Node.js 20+. No external packages or API credentials are needed.

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
