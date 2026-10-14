> Historical report included in the supplied ZIP. These checks were not rerun as part of the 2.1.5 update. See TESTING.md for current verification.

# Verification — THRASH-PASS 2.1.3

Tested on Windows, 13 October 2026.

**37 automated checks passed.**

## Background logic: 15 passed

Available Gemini model selection; missing-model fallback; authentication failure without retry; paginated model discovery; transient retry; Retry-After handling; stalled response-body timeout; custom image payload; Kimi screenshot rejection; truncated answer detection; empty response detection; endpoint validation; Presentation Mode request blocking; wrong-tab screenshot rejection; active-tab screenshot routing.

These tests use controlled provider responses and mocked Chrome APIs.

## Browser behavior: 15 passed

Duplicate injection; immediate Presentation Mode updates; password-field exclusion; duplicate AI request suppression and late answer suppression; screenshot overlay hiding and image forwarding; textarea selection replacement and input events; rich-text insertion containment; selection restoration after assistant focus; unsupported code-editor rejection; stopping active auto-type; Monaco cursor advancement; Monaco read-only rejection; isolated provider profiles; popup error recovery; no uncaught browser errors.

These tests run in an actual Chrome DOM with mocked extension APIs. Monaco adapter tests use a simulated editor API; they do not certify every website's Monaco integration.

## Installed extension: 7 passed

Loaded the actual unpacked extension into Chrome for Testing 151.0.7922.34 using a separate temporary browser profile:

- Manifest, service worker, and popup initialize.
- Popup → service worker → local HTTP mock provider → popup completes.
- Content script sends page context and renders the worker response.
- MAIN-world insertion preserves the textarea selection.
- Cross-frame selection and auto-type work through real extension APIs.
- Storage changes enable/disable existing content scripts without a page refresh.
- No uncaught extension-page errors during the tested flow.

## Limits of verification

No live Gemini, OpenAI, or Moonshot credentials were supplied, so live account access, billing/quota, provider-specific model availability, and external AI responses were not tested. Screenshots were checked with controlled capture responses; real screen capture was not exercised in the installed-extension test. Arbitrary third-party editors, protected browser pages, and every browser/version cannot be guaranteed.

The original archive is unchanged. Tests used local mock credentials and a local mock AI server; no user API key was used.
