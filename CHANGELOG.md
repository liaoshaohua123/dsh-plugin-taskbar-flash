# Changelog

All notable changes to this plugin are recorded here. Versions follow [Semantic Versioning](https://semver.org/).

## 1.5.0

### Fixed

- **Add sound** could do nothing at all: the file list was read after the input had already been reset, which yields an empty selection in Chromium, so the handler returned silently. The picked files are now captured before the reset.
- A failed upload now names the file and the reason (HTTP status plus the Host's error code) instead of failing quietly.

### Added

- **Add sound** button: pick one or more audio files from this computer and they are copied into `custom-sounds/` and listed in both menus right away. Existing names are never overwritten (`mine.wav` becomes `mine-2.wav`).
- Inline feedback instead of silence: **Save**, **Add sound**, and the trim studio now answer in place — green text naming what was added, red text explaining a failure — and the success line clears itself after a few seconds. No modal to dismiss.
- The settings card shows the loaded version (`v1.5.0`) in its top-left corner.

## 1.4.0

### Added

- Separate sounds for **completion** and **pending approval**, with a "same as completion" option for approvals.
- Built-in sound library grown to ten entries; new defaults are *Deep hum* for completion and *Triple blip* for approvals.
- **Trim studio**: drop in a local audio file, drag the selection, preview only that span, name it, and save it as WAV into the custom sound folder.
- In-panel **中文 / English** switch; the choice is remembered locally and leaves the rest of DSH untouched.

### Changed

- Custom sounds now live in `custom-sounds/` inside the plugin directory instead of a separate user folder.

## 1.3.0

### Added

- Custom sound files: drop audio into the sound folder and it appears in both menus, no rebuild required.

## Earlier

- Completion, question, and approval reminders; taskbar flashing while DSH runs in the background; foreground reminders stay silent-only on the window.
