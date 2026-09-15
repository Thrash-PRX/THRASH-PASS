# Changelog

## 2.1.4

- Make connection testing use one request with a strict 10-second timeout instead of the normal recovery loop.
- Report distinct messages for invalid credentials, unavailable models, quota limits, and temporary Gemini overload.

## 2.1.3

- Automatically discover available general-purpose Gemini Flash alternatives after retryable failures.
- Show retry progress and the successful model in the page panel.
- Honor Retry-After, increase retry delays, and cap generation attempts at six within a 90-second recovery budget.
- Stop further page retries when Presentation Mode is enabled or provider credentials change.
- Preserve original icon bytes and existing saved settings.


## 2.1.2

- Separate installable extension from documentation and development tools.
- Refresh settings branding, labels, focus indicators, status announcements, and usage/privacy hints.
- Remove overlays and stop targeting when Presentation Mode is enabled; block new page AI requests in the worker.
- Check the requesting tab before screenshot capture; clearly reject unsupported screenshot providers.
- Reset unsaved key/endpoint and default model when changing providers.
- Exclude password, unsupported, disabled, and read-only fields from insertion.
- Prevent contenteditable fallback insertion outside the chosen destination.
- Handle popup action errors and avoid empty screenshot requests and duplicate submissions.
- Preserve existing configuration keys, provider adapters, Gemini retry/fallback behavior, and editor integrations.
- Add documentation, artwork, package checks, and regression tests.

### Original icon restoration

- Restored all four icon PNG files byte-for-byte from the uploaded archive, without resizing or recompression.
- Validate their SHA-256 hashes to prevent accidental artwork changes.
