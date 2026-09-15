# Architecture

Unbundled Manifest V3 extension with no production dependencies.

- popup.html / popup.css / popup.js: settings, model discovery, testing, Presentation Mode.
- contentScript.js: editor tracking in HTTP/HTTPS frames; floating assistant in a closed shadow root in the top frame only.
- worker.js: provider calls, shortcuts, menus, capture, and editor insertion through MAIN-world scripts.

Gemini uses generateContent and inline images. OpenAI uses chat completions with text/image content. Kimi and Custom support text requests; screenshots produce an explicit unsupported-provider error.

Gemini tries the saved model first. After a retryable failure it discovers paginated generateContent models, filters general-purpose Flash alternatives, and rotates candidates with increasing delays. Specialist image/audio/live models are excluded from automatic selection. Missing models (404) are removed. Six generation attempts and a 90-second recovery budget prevent endless retries. Fetches use at most 25 seconds; discovery pages use at most 10 seconds within the budget. Retry-After is never shortened. Invalid credentials stop immediately. Progress messages identify attempts and the successful model. Saved settings remain unchanged. Page retry guards stop on Presentation Mode or a changed provider/key.

Storage keys, DOM markers, commands, and menu IDs are preserved. Updating an unpacked extension in the same folder preserves its installation; loading a new path can create a separate installation that needs configuration.

Enabling Presentation Mode updates initialized content scripts and gates new page actions in the worker. Pages that skipped initialization need refresh when it is disabled. Running work is not cancelled.

Editor targeting uses recent focus markers across frames. Insertion uses Monaco, CodeMirror 5, Ace APIs when exposed, otherwise DOM operations. Closed shadow DOM limits style collisions but is not a security boundary. Website text and generated code are untrusted. AI output is never evaluated by the extension.
