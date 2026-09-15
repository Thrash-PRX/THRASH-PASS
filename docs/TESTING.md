# Validation and limitations

Run `npm test` with Node.js 20+. No external packages or API credentials are needed.

Automated checks cover manifest references, version consistency, JavaScript syntax, original icon SHA-256 integrity, popup assets, provider payload adapters, settings provider-switch behavior, Presentation Mode gates, screenshot target checks, invalid endpoints, missing keys, and sensitive input exclusion. Browser and provider APIs are mocked; this does not establish live provider compatibility.

Manual release checklist:

1. Load `extension/` unpacked and check the extension error panel.
2. Configure each available provider, test it, and refresh Gemini models.
3. Open from page/selection menus and keyboard shortcut on an ordinary webpage.
4. Send text and screenshots with a vision-capable provider; switch tabs during capture.
5. Copy/paste/auto-type into textareas, contenteditable, frames, Monaco, CodeMirror 5, and Ace where available.
6. Enable Presentation Mode on an existing page; confirm the panel disappears and new requests are blocked. Disable it, refresh, and open again.
7. Verify on your intended Chrome/Edge version and site.

Known limitations: live AI calls require user credentials; site editors vary; contenteditable cursor restoration and framework-controlled fields can be imperfect; body text is truncated without semantic selection; screenshots may include the overlay; page content may contain prompt injection; running requests/insertion are not cancelled by Presentation Mode. Pages initialized while Presentation Mode is on need refresh after it is off.

This release is not claimed to be store-reviewed or exhaustively tested across browsers and websites.

## Results for 2.1.3

Package validation and all fourteen mocked regression tests passed. The settings layout was visually inspected through a local HTTP preview; the expected missing extension-storage error in that preview does not exercise actual extension loading. Live provider calls and the manual browser/editor checklist above were not run. A source scan found no apparent embedded API credentials or dynamic code evaluation.


Recovery regression tests cover overload → discovered model success, screenshot preservation, long Retry-After, authentication failure, the six-attempt limit, and cancellation before requests. Live Gemini capacity remains unverified without a provider key.
