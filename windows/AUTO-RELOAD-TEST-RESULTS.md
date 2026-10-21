# Automatic reload verification: extension 2.3.0 and Windows updater 1.1.0

Verified on 21 October 2026 in a disposable GitHub-hosted Windows VM.

[Successful test run](https://github.com/Thrash-PRX/THRASH-PASS/actions/runs/39623507107) · Source tested: `5401a04`

All four suites passed:

| Suite | Passed | What it proves |
| --- | --- | --- |
| Extension regression tests | 16 | Existing provider/page behavior plus complete-package, idle, popup, and request guards |
| Isolated Chromium integration checks | 16 | Actual automatic reload, page reconnection, and state preservation |
| Native updater assertions | 12 | Archive validation, version checks, backup, and failure rollback |
| Windows VM integration checks | 16 | Actual executable installation, scheduled execution, automatic file updates, and disabling |

Chromium version tested in the VM: `156.0.8078.4`. A separate local disposable profile also passed on Chromium `153.0.8010.12`.

The browser test loads the candidate 2.3.0 extension in a temporary folder and profile with Developer mode enabled. It opens a draft, replaces the extension folder with a complete copy advertising the next patch version, and confirms that reload waits until the draft panel is closed. A real alarm then triggers the automatic reload. The loaded runtime changes version, the existing webpage retains unsaved textarea content without navigation, saved extension settings survive, and exactly one functioning assistant reconnects to the page. The test never invokes `chrome.runtime.reload()` directly. It accelerates the next alarm tick instead of waiting a minute.

The native integration suite independently downloads the version currently published on main, checks its six-hour scheduled task configuration, runs the actual installed executable through Task Scheduler, simulates an older build to trigger replacement, and disables the task. It does not wait six hours.

The release executable is taken directly from the successful VM artifact. SHA-256:

```text
d0902c9376e145b2604db6e7d944cc57fcdef11d97703093420a8afa396cbe08
```

Scope: these tests use disposable profiles and dummy settings. They do not test actual AI-provider credentials, manual GUI buttons, visual Windows notification delivery, or every third-party website. Open assistant panels and popup editing intentionally defer reload. Existing extensions older than 2.3.0 need one initial load/reload to gain the watcher, and Developer mode must remain enabled. No installed user extension or normal browser profile was modified during verification.
