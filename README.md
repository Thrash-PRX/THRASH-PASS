# THRASH-PASS

**Your page. Your AI provider.** A lightweight browser assistant for asking about webpages, understanding screenshots, and bringing answers into your editor.

![THRASH-PASS](docs/assets/banner.svg)

Manifest V3 · Version 2.1.4 · Chrome / Chromium · No build step · Bring your own API key

## Features

- Ask about selected text or the current page in a floating panel.
- Connect Gemini, OpenAI, Kimi / Moonshot, or a custom OpenAI-compatible endpoint.
- Send visible-tab screenshots through Gemini or OpenAI with an image-capable model.
- Copy answers, paste into the last focused editor, or insert gradually with Auto-type.
- Presentation Mode hides the panel and blocks new page requests, captures, and insertions.

## Install

1. Choose **Code → Download ZIP** on this repository and extract it.
2. Open `chrome://extensions` (or `edge://extensions`) and enable **Developer mode**.
3. Click **Load unpacked** and select the **extension** folder containing `manifest.json`.
4. Pin THRASH-PASS to the toolbar and refresh existing webpages.

This is a manually installed extension, not a Chrome Web Store listing. Node.js is not needed to use it.

## Configure and ask

1. Click the toolbar icon, choose a provider, enter its API key and model ID, then **Save settings**.
2. Gemini users can **Refresh Gemini models** to find models available to their key. Custom requires the complete chat-completions endpoint URL and a model ID.
3. **Test connection** sends a small test prompt. Both Test and Refresh also save your current settings.
4. Select page text and right-click **Ask THRASH-PASS about selection**, right-click the page, or press **Ctrl+Shift+Y** (**Command+Shift+Y** on Mac).
5. Enter a request and click **Ask AI**, or press **Ctrl/Command+Enter**. **Screenshot** sends that request with a visible-tab image.

## Insert an answer

Click the destination editor first, then **Paste code** or **Auto-type** in the assistant. The first fenced code block is used when present; otherwise the whole answer is inserted. Existing selected text may be replaced. **Copy** uses the same extraction rule.

Supports text inputs, textareas, contenteditable, and accessible Monaco, CodeMirror 5, and Ace integrations. Site-specific editors may reject insertion; Copy is the fallback. Password, email, numeric, disabled, and read-only fields are excluded. The extension does not submit forms or execute generated code.

## Presentation Mode

The toggle saves immediately. Enabling it removes active panels, stops editor targeting, removes assistant context menus, and blocks new page AI requests, captures, and insertions. Refresh webpages after disabling it. Already-running requests or auto-typing may finish; enable it before presenting. Settings-side connection tests remain available.

## Privacy

Each question sends your request **plus up to 12,000 characters of visible page text** to your configured provider. Screenshot adds the visible tab image, potentially including the assistant panel and private information. The package has no project-operated backend, analytics, or saved conversation history.

Keys live in `chrome.storage.local`, not an encrypted vault. Broad HTTP/HTTPS permissions support page integration and custom endpoints. An endpoint override receives your key; use trusted endpoints. See [Privacy and permissions](docs/PRIVACY.md).

## Gemini recovery (v2.1.4 preferred build)

Your selected model is tried first. On overload, temporary failures, rate limits, or an unavailable model, THRASH-PASS falls back through an ordered list of general-purpose Flash models that have proven reliable in practice:

- gemini-3.5-flash-lite
- gemini-3.7-flash
- gemini-3.6-flash
- gemini-3.5-flash
- gemini-3.1-flash-lite
- gemini-2.5-flash-lite
- gemini-2.5-flash

Requests use a 120-second timeout and, for Gemini 3 models, `thinkingLevel: "low"` for lower latency. Up to five generation attempts are made. Authentication errors stop immediately. Progress messages show which model is being tried.

## Troubleshooting

- **Panel missing:** refresh the page, disable Presentation Mode, and check `chrome://extensions/shortcuts`. Browser-internal and extension-store pages restrict content scripts.
- **Authentication/model error:** check the key, provider, model access, and endpoint. Gemini retries transient failures and may fall back to another model.
- **Screenshot fails:** use Gemini/OpenAI with an image-capable model and keep the requesting tab active.
- **Insertion fails:** click inside the destination again or use Copy.

## Development

Run `npm test` with Node.js 20+. No dependency installation is needed. Load `extension/` directly and reload it after edits.

| Folder | Purpose |
| --- | --- |
| `extension/` | Installable runtime and icons |
| `docs/` | Privacy, architecture, testing, and artwork |
| `tests/` | Regression tests with mocked browser/provider APIs |
| `scripts/` | Package validation |

See [Architecture](docs/ARCHITECTURE.md), [Testing](docs/TESTING.md), [Contributing](CONTRIBUTING.md), and [Changelog](CHANGELOG.md).

The supplied archive had no license. That status is preserved; public availability does not establish reuse rights. See [Provenance](docs/PROVENANCE.md).
