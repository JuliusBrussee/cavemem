---
'@cavemem/config': minor
'cavemem': minor
'@cavemem/embedding': patch
---

feat(config): resolve cavemem home dir via CAVEMEM_HOME / XDG (#47)

cavemem was hardcoded to `~/.cavemem` for settings.json, data.db, the worker
pidfile/state, and the model cache. Issue #47 asked for a way to stop
polluting `$HOME` and/or relocate the data dir. `@cavemem/config` now
resolves the cavemem home directory in this order:

1. `CAVEMEM_HOME` env var, if set.
2. An existing `~/.cavemem` — zero breaking change for every current install.
3. `XDG_DATA_HOME/cavemem` whenever the var is explicitly set — on any
   platform, not just Linux. Without the var, Linux uses the XDG default
   `~/.local/share/cavemem`; macOS/Windows keep `~/.cavemem`.

Non-absolute env values (no leading `/`, drive letter, or `~`) are ignored —
treated as unset, per the XDG spec. Hooks run with cwd = the project dir, so
a relative `CAVEMEM_HOME` would otherwise silently fragment the store
per-project.

The resolution is pure `fs.existsSync` checks (no globbing) and cached per
process, so it's cheap on the hooks/worker hot path. `settings.dataDir`
still overrides the data location specifically when set explicitly in
settings.json — its default is now the resolved home dir above instead of a
hardcoded `~/.cavemem`; `.describe()` spells out the difference between the
two. To keep settings.json portable across machines (dotfile sync, restored
backups, containers), `saveSettings` omits `dataDir` from the persisted file
unless the user set it explicitly — the default is re-resolved on every
load. `saveSettings` also always writes to the resolved home now (previously
a custom `dataDir` would redirect the save to a location `loadSettings`
never reads). `cavemem doctor` / `cavemem status` already printed the
resolved `settings`/`dataDir` paths, so both surface the new resolution with
no command changes.

`@cavemem/embedding`'s musl error message no longer hardcodes
`~/.cavemem/settings.json`, since that path is no longer always accurate.
