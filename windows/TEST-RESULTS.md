# Windows updater 1.0.1 verification

Tested on 21 October 2026 in a fresh GitHub-hosted Windows VM, not the user's Windows installation. The runtime was Windows Server 2025, the `windows-latest` runner image. This is an isolated hosted VM rather than the local Windows Sandbox product.

[Successful Windows VM test run](https://github.com/Thrash-PRX/THRASH-PASS/actions/runs/39620382696)

Source tested: `95839b7` (updater source and sandbox script). The released executable is copied directly from this successful run's artifact, not rebuilt after testing.

SHA-256 of the tested executable:

```text
4822ff360afcecbe6a8a25e205453c046a0431de2e598c26ce28ebbb3ee977d8
```

All 12 core assertions and all 16 integration checks passed:

1. Fresh installation matches the published extension version.
2. Updater copies itself into the installation folder.
3. Installed executable matches the tested executable.
4. Scheduled task executable path is quoted correctly.
5. Scheduled task uses `--background`.
6. Scheduled task repeats every six hours.
7. Scheduled task uses limited privileges.
8. An up-to-date check leaves installed files intact.
9. An older build upgrades automatically from the official GitHub download.
10. Obsolete files disappear from the active installation.
11. The previous build remains available for recovery.
12. Successful updates are logged.
13. Windows Task Scheduler successfully runs the installed executable (exit code 0).
14. Disabling updates removes the scheduled task.
15. Disabling updates preserves the installed extension.
16. Successful updates leave no staging directories.

The core assertions additionally cover invalid versions, unsafe archive paths, mismatched downloaded versions, extension-only extraction, and rollback when activation fails.

The test triggers the scheduled task immediately and verifies its six-hour configuration; it does not wait six hours. It exercises executable installation and background update modes, not manual GUI button interaction, Chrome's Load unpacked/reload flow, actual AI-provider requests, or visually displayed Windows notifications. User notification preferences and browser behavior remain outside this test's scope.

The first VM run passed the same integration checks but failed while collecting logs across different Windows drives. That workflow-only artifact path was corrected, and the complete run above passed, including evidence upload. No updater installation or scheduled task was created on the user's PC during these tests.
