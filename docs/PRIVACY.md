# Privacy and permissions

THRASH-PASS sends requests directly to your configured AI endpoint, without a project backend.

| Action | Data and destination |
| --- | --- |
| Ask AI | Request plus first 20,000 characters of body.innerText to provider |
| Screenshot | Same text plus visible-tab PNG to Gemini/OpenAI |
| Test connection | Fixed short test prompt and authentication to provider |
| Refresh Gemini models | Authentication to Google's model-list API |
| Paste / Auto-type | Extracted answer to the selected webpage editor; the website may observe/store it |
| Copy | Extracted answer to system clipboard |

Page text can contain private data and untrusted instructions. Screenshots include visible information and can include the assistant panel. Excluding password fields from insertion does not redact screenshots.

Settings and API keys use chrome.storage.local. This is not an encrypted vault; the extension's own content scripts can access it under Chrome's default rules. The password field merely masks the popup display. No conversation history is persisted by this extension; provider retention and billing depend on your account. Answers remain in page memory until the page closes/reloads.

| Permission | Reason |
| --- | --- |
| storage | Configuration and Presentation Mode |
| activeTab | User-invoked page access and capture |
| contextMenus | Page and selection entry points |
| tabs | Active-tab lookup, messages, screenshot target check |
| scripting | Editor discovery/insertion including frames |
| HTTP/HTTPS hosts | Cross-site page integration and custom endpoint requests |

Broad host access is retained for compatibility; redundant provider-specific entries were removed. The extension does not fetch remote executable code. Responses are displayed as plain text and inserted only when the user clicks an insertion button.

Presentation Mode blocks new page operations but does not cancel work in progress. Disable/remove the extension to stop it completely. Clear and save the API key field, or uninstall, to remove saved credentials. Use HTTPS for remote endpoints; HTTP remains supported for local servers.

Reference: [Chrome extension storage](https://developer.chrome.com/docs/extensions/reference/api/storage/).
