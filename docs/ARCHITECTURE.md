# Architecture

Unbundled Manifest V3 extension with no production dependencies.

- settings.js: shared defaults loaded by the popup and service worker.
- popup.html / popup.css / popup.js: provider profiles, model discovery, connection testing, Presentation Mode, page opening, and manual update checks.
- contentScript.js: editor tracking in HTTP/HTTPS frames and a top-frame assistant in a closed shadow root.
- worker.js: provider calls, shortcuts, menus, capture, update notifications, and MAIN-world editor insertion.

The service worker reads version metadata from the repository's `update.json` on startup and through a six-hour Chrome alarm. It compares semantic versions, stores the last result, sets a toolbar badge, and emits at most one notification per newer version. It opens only a validated page under the official GitHub repository. This remote check does not install files.

The Windows helper updates the local extension folder. A separate one-minute alarm fetches local packaged resources with caching disabled. The worker requires a newer manifest version, nonempty runtime files, and two observations of the candidate. The candidate is stored in `pendingLocalUpdate` so worker suspension between alarm ticks does not discard it. Reload is deferred during active operations, an open popup, or an open assistant panel. It then asks content scripts to remove their listeners, target markers, and panels before calling `chrome.runtime.reload()`. The update installation event reinjects content scripts into ordinary open webpages, guarded against duplicate initialization. Webpages are never refreshed. This requires 2.3.0+ already running; older builds need a one-time manual reload.

Gemini discovers account-available general-purpose models with pagination and bounded fallback. Requests use 25-second deadlines including response bodies. Authentication failures stop immediately. Gemini has at most four generation attempts across three candidates; other providers have at most two attempts. Message operations have a bounded overall deadline and keep the worker responsive while pending.

OpenAI and custom compatible endpoints receive text/image payloads. Kimi screenshots fail explicitly. API keys, models, and endpoints are stored separately per provider, with the existing active-provider storage keys retained for upgrades.

Presentation Mode updates initialized content scripts immediately, removes the overlay, clears editor markers, stops auto-type on the next chunk, and suppresses late results. Already-sent provider requests cannot be recalled.

Editor insertion uses exposed Monaco, CodeMirror 5, and Ace APIs or supported DOM fields. Website text is untrusted reference material. AI output is displayed as text and never evaluated by the extension.
