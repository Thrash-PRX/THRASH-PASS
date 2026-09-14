# Changelog

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
