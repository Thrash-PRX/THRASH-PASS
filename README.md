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

Changing providers clears the unsaved key and endpoint and chooses a provider-specific default model. Enter the new provider's credentials before saving.

## Insert an answer

Click the destination editor first, then **Paste code** or **Auto-type** in the assistant. The first fenced code block is used when present; otherwise the whole answer is inserted. Existing selected text may be replaced. **Copy** uses the same extraction rule.

Supports text inputs, textareas, contenteditable, and accessible Monaco, CodeMirror 5, and Ace integrations. Site-specific editors may reject insertion; Copy is the fallback. Password, email, numeric, disabled, and read-only fields are excluded. The extension does not submit forms or execute generated code.

## Presentation Mode

The toggle saves immediately. Enabling it removes active panels, stops editor targeting, removes assistant context menus, and blocks new page AI requests, captures, and insertions. Refresh webpages after disabling it. Already-running requests or auto-typing may finish; enable it before presenting. Settings-side connection tests remain available.

## Privacy

Each question sends your request **plus up to 20,000 characters of visible page text** to your configured provider. Screenshot adds the visible tab image, potentially including the assistant panel and private information. The package has no project-operated backend, analytics, or saved conversation history.

Keys live in `chrome.storage.local`, not an encrypted vault. Broad HTTP/HTTPS permissions support page integration and custom endpoints. An endpoint override receives your key; use trusted endpoints. See [Privacy and permissions](docs/PRIVACY.md).

## Automatic Gemini recovery

Enabled automatically in v2.1.3. Your selected model is tried first. On overload, temporary service failures, rate limits, or an unavailable model, THRASH-PASS queries Gemini for currently listed general-purpose Flash alternatives, waits with increasing delays, and switches automatically. The panel shows progress and the model that answered. Your saved model and provider are not changed.

Recovery is limited to six generation attempts and a 90-second budget, with up to 25 seconds per fetch. Longer provider Retry-After delays stop recovery instead of being shortened. Authentication errors stop immediately. Turning Presentation Mode on stops further page retries. Model discovery does not guarantee capacity or image support; if all attempts fail, retry later. Different models can have different quality and prices.

## Troubleshooting

- **Panel missing:** refresh the page, disable Presentation Mode, and check `chrome://extensions/shortcuts`. Browser-internal and extension-store pages restrict content scripts.
- **Authentication/model error:** check the key, provider, model access, and endpoint. Gemini retries transient failures and may fall back to another model, affecting results and costs.
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
