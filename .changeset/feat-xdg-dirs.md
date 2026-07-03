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

1. `CAVEMEM_HOME` env var, if set — used verbatim.
2. An existing `~/.cavemem` — zero breaking change for every current install.
3. `XDG_DATA_HOME/cavemem` (or, on Linux with no XDG var, `~/.local/share/cavemem`)
   for new installs on Linux. macOS/Windows without an explicit XDG var keep
   `~/.cavemem`.

The resolution is pure `fs.existsSync` checks (no globbing) and cached per
process, so it's cheap on the hooks/worker hot path. `settings.dataDir`
still overrides the data location specifically when set explicitly in
settings.json — it no longer hardcodes `~/.cavemem` as its default, but
instead defaults to the resolved home dir above; `.describe()` now spells
out the difference between the two. `cavemem doctor` / `cavemem status`
already printed the resolved `settings`/`dataDir` paths, so both now surface
the new resolution with no command changes.

`@cavemem/embedding`'s musl error message no longer hardcodes
`~/.cavemem/settings.json`, since that path is no longer always accurate.
