# Architecture

Unbundled Manifest V3 extension with no production dependencies.

- popup.html / popup.js: settings, model discovery, testing, Presentation Mode (styles inlined).
- contentScript.js: editor tracking in HTTP/HTTPS frames; floating assistant in a closed shadow root in the top frame only.
- worker.js: provider calls, shortcuts, menus, capture, and editor insertion through MAIN-world scripts.

Gemini uses generateContent and inline images. OpenAI uses chat completions with text/image content. Kimi and Custom support text requests; screenshots produce an explicit unsupported-provider error.

### Gemini recovery (preferred 2.1.4 build)

The saved model is tried first. On retryable failure the worker walks a fixed, ordered list of general-purpose Flash models that have proven reliable. Specialist image/audio/live models are not used for automatic fallback. Requests use a 120-second timeout; Gemini 3 models receive `thinkingConfig.thinkingLevel = "low"` for lower first-token latency. Up to five generation attempts are made. Authentication errors stop immediately. Progress messages identify the current model. Saved settings are never changed by recovery.

Storage keys, DOM markers, commands, and menu IDs are preserved. Updating an unpacked extension in the same folder preserves its installation; loading a new path can create a separate installation that needs configuration.

Enabling Presentation Mode updates initialized content scripts and gates new page actions in the worker. Pages that skipped initialization need refresh when it is disabled. Running work is not cancelled.

Editor targeting uses recent focus markers across frames. Insertion uses Monaco, CodeMirror 5, Ace APIs when exposed, otherwise DOM operations. Closed shadow DOM limits style collisions but is not a security boundary. Website text and generated code are untrusted. AI output is never evaluated by the extension.
