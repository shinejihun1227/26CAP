# AI integration verification — 2026-09-14

Verified from a separate worktree based on `origin/wongi` (`8cbd7d2`).

- 119 web regression/unit tests: passed (sensor hub, four-channel pressure, UI states, MediaPipe/ROM, trend persistence).
- 1 full HTTP test: passed separately using synthetic bilateral sensors, actual bundled RF/CNN weights, the collector cursor endpoint, Python service and the real web proxy. Also checks calibration start/cancel, one-foot loss, full disconnect and null scores. Final run measured about 60/61 Hz input. Synthetic score values are test outputs, not clinical evidence.
- 16 AI integration tests: passed (real weights, CSV replay, calibration capture/validation, timestamps, missing/invalid/duplicate/slow/stale data, reboot/gap reset, separate feet and yaw diagnostics).
- 6 existing AI runtime tests: passed after updating bridge entry point and explicit calibration-missing status.
- `node tests/check-web.mjs`: passed syntax/imports, four-channel pressure rules and 67 HTTP routes/assets.
- All three deployed model artifact files match the uploaded ZIP by SHA-256. Model weights and thresholds were not changed by the web integration.

A cold Python startup overlapped with heavy parallel ROM file tests and exceeded the initial 25-second test startup timeout once. The full HTTP test passed in isolation (about 9 seconds overall), and the documented test command now serializes test files with a 45-second startup allowance.

Browser UI automation timed out in its provider. HTML/render/API checks passed; a visual browser inspection is not claimed. Physical ESP32 sensor capture, wearer-specific calibration and clinical model accuracy remain unverified here. The running local service reports `calibration_missing`, `coverage: 0` and null scores because no real devices/calibration are supplied. No synthetic calibration was installed into the user's runtime data directory.
