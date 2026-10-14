# Architecture

Unbundled Manifest V3 extension with no production dependencies.

- settings.js: shared defaults loaded by the popup and service worker.
- popup.html / popup.css / popup.js: provider profiles, model discovery, connection testing, Presentation Mode, and page opening.
- contentScript.js: editor tracking in HTTP/HTTPS frames and a top-frame assistant in a closed shadow root.
- worker.js: provider calls, shortcuts, menus, capture, and MAIN-world editor insertion.

Gemini discovers account-available general-purpose models with pagination and bounded fallback. Requests use 25-second deadlines including response bodies. Authentication failures stop immediately. Gemini has at most four generation attempts across three candidates; other providers have at most two attempts. Message operations have a bounded overall deadline and keep the worker responsive while pending.

OpenAI and custom compatible endpoints receive text/image payloads. Kimi screenshots fail explicitly. API keys, models, and endpoints are stored separately per provider, with the existing active-provider storage keys retained for upgrades.

Presentation Mode updates initialized content scripts immediately, removes the overlay, clears editor markers, stops auto-type on the next chunk, and suppresses late results. Already-sent provider requests cannot be recalled.

Editor insertion uses exposed Monaco, CodeMirror 5, and Ace APIs or supported DOM fields. Website text is untrusted reference material. AI output is displayed as text and never evaluated by the extension.
