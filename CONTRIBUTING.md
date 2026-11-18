# Contributing

Thanks for taking a look. This plugin is deliberately small: plain ES modules, no build step, no runtime dependencies beyond what DSH already provides.

## Before you start

- Windows 10/11, DSH desktop, PowerShell 7 (`pwsh.exe`).
- For the reminder paths, DSH's subprocess sandbox refuses Windows PowerShell 5.1 with `spawn EPERM` — that is why `pwsh` is mandatory.
- The plugin is installed by linking a checkout, so your edits are live after a reload.

## Dev loop

```powershell
# 1. link the checkout into a profile (see README → Install)
# 2. reload the plugin: toggle it off and on in the Plugins page (Host changes),
#    refresh the page (Client changes)
# 3. run the tests
node test/reminders.test.mjs
node test/sounds.test.mjs
```

`node --test test` also works outside a sandbox; inside one, run the files directly.

## Layout

| File | Role |
| --- | --- |
| `index.js` | Host half: event wiring, config schema, sound folder + routes, playback |
| `client.js` | Browser half: the settings card, sound menus, trim studio, i18n |
| `flash-window.ps1` | Window targeting and `FlashWindowEx`; also the manual probe/flash entry point |
| `sounds/*.wav`, `reminder.wav` | Generated audio, committed so installs stay offline |
| `tools/generate-chime.py` | The generator every built-in sound comes from |
| `locale/*.json` | Title and description shown in the Plugins page |

## Rules of thumb

- **Sounds are generated, not sampled.** If you add or retune one, change `tools/generate-chime.py`, regenerate, and commit both.
- **Never guess the window from its title.** Window targeting goes through the Host process ancestry in `flash-window.ps1`.
- **Register `session/event` listeners with `{ global: true }`.** A scoped `ctx.on` can be filtered out and silently miss events.
- **Keep user files out of the repository.** `custom-sounds/`, logs, and local backups are git-ignored; do not commit them.
- **Both locales.** Any new UI string needs an entry in the `zh` and `en` dictionaries inside `client.js`.
- **No new dependencies** unless there is no reasonable way around it.

## Versioning

The version lives in `package.json` and is what DSH shows on the plugin's detail page and, as a small `vX.Y.Z` line, at the top of the settings card (the Host reports it on `GET /plugins/taskbar-flash/sounds`).

Follow [Semantic Versioning](https://semver.org/):

| Change | Bump |
| --- | --- |
| Fix a sound, a route guard, or a flash bug | **patch** — `1.5.0` → `1.5.1` |
| Add a sound option, a route, a control, or a new supported format | **minor** — `1.5.1` → `1.6.0` |
| Rename the loader id, the route prefix, a config key, or drop a supported DSH release | **major** — `1.6.0` → `2.0.0` |

Rules that keep it honest:

- Bump `package.json` and add the `CHANGELOG.md` entry in the **same commit**. Never let the two drift.
- A released version is frozen: fix forward with a new patch, do not edit history.
- Tag the release `v<version>` (for example `v1.5.0`) and paste the matching `CHANGELOG.md` section into the GitHub release body.
- Users install by linking a checkout, so nothing enforces a version for them — the number is a promise to the reader, not a mechanism.

## Pull requests

- One topic per PR, with a short note on what you tested on which Windows version.
- Add a `CHANGELOG.md` line under an unreleased heading.
- If the change touches playback or flashing, include the `flash-window.ps1` command you used to verify it.
