# @cavemem/embedding

## 0.3.0

### Patch Changes

- 51e3608: feat(config): resolve cavemem home dir via CAVEMEM_HOME / XDG (#47)

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

- f2e2f49: Issue sweep: fix six bugs across config, installers, and embedding.

  - **config (#25):** Correct the inverted description for `search.alpha`. The
    ranker computes `alpha * bm25 + (1 - alpha) * cosine`, so `1 = pure BM25`
    and `0 = pure cosine`. Doc-only — no behavior change.
  - **installers/claude-code (#19):** Write the cavemem MCP server entry to
    `~/.claude.json` instead of `~/.claude/settings.json`. Newer Claude Code
    reads MCP config from `~/.claude.json`; the previous location was silently
    ignored. Hooks continue to live in `~/.claude/settings.json`. Legacy
    `mcpServers.cavemem` entries in `settings.json` are migrated out on
    install.
  - **installers/claude-code (#12):** Stop overwriting pre-existing entries in
    `hooks.SessionStart` / `PostToolUse` / etc. The installer now appends
    cavemem's hook to whatever is already there and writes a one-shot
    `settings.json.pre-cavemem-<unix-ts>` backup before mutating a file with
    prior hooks. Re-running install no longer duplicates cavemem entries.
  - **installers/codex (#17):** Switch from `~/.codex/config.json` (which
    Codex never read) to `~/.codex/config.toml` with the `[features]
codex_hooks = true` flag and an `[mcp_servers.cavemem]` table. Also write
    `~/.codex/hooks.json` with `SessionStart` / `UserPromptSubmit` /
    `PostToolUse` / `Stop` entries so observations are actually captured.
    Adds `smol-toml` as a dependency (bundled into the CLI dist).
  - **installers/opencode (#14):** Drop a generated plugin at
    `~/.config/opencode/plugins/cavemem.js` that hooks into
    `session.created` / `session.idle` / `tool.execute.before` /
    `tool.execute.after` and forwards to `cavemem hook run …`. Previously the
    installer only registered an MCP server and no hooks fired at all, so
    observations were empty. Plugin is registered in `opencode.json` and
    uses detached `child_process.spawn` so the IDE never blocks on a hook.
    Path migrated to OpenCode's documented global config location
    (`~/.config/opencode/`, honoring `XDG_CONFIG_HOME`).
  - **embedding (#20):** Detect musl libc (Alpine, musl-built Node) before
    importing `@xenova/transformers`. The bundled `onnxruntime-node` prebuilts
    target glibc and have segfaulted on Alpine in the wild; we now throw a
    clean error pointing at `embedding.provider: 'none' | 'ollama'`.

- 061473a: Migrate the local embedding provider from `@xenova/transformers@2` to `@huggingface/transformers@3`.

  `@xenova/transformers` is deprecated and pins an old `onnxruntime-web` →
  `onnx-proto` → `protobufjs` chain carrying multiple published `protobufjs`
  advisories, including a critical arbitrary-code-execution issue
  (GHSA-xq3m-2v4x-88gg). `@huggingface/transformers@3` is the maintained
  successor: same `pipeline()` / `env` API, but resolves a current, patched
  `protobufjs`, clearing those advisories. (The unrelated `qs` moderate
  advisory some audits report comes from `express`/`body-parser`, not this
  dependency chain, and is unaffected by this change.)

  The v2 `quantized: true` pipeline flag was removed in v3; it is replaced with
  `dtype: 'q8'` (int8 weights, matching the old quantized default). Embedding
  output is unchanged — same model (`Xenova/all-MiniLM-L6-v2`), same 384 dims —
  so existing stored vectors stay compatible and no re-embed is triggered.

- Updated dependencies [dec94ef]
- Updated dependencies [51e3608]
- Updated dependencies [b5976a5]
- Updated dependencies [6dc2ae5]
- Updated dependencies [f2e2f49]
  - @cavemem/config@0.3.0

## 0.2.0

### Minor Changes

- 416957b: Wire embeddings end-to-end and make lifecycle obvious.

  **Embeddings (previously dead code) now work out of the box**

  - New `@cavemem/embedding` package exports `createEmbedder(settings)` with three providers: `local` (Transformers.js, default — `Xenova/all-MiniLM-L6-v2`, 384 dim), `ollama`, and `openai`. `@xenova/transformers` is an optional dependency: installs automatically with `npm install -g cavemem` on supported platforms, falls back gracefully otherwise.
  - The worker now runs an embedding backfill loop: polls `observationsMissingEmbeddings`, embeds the expanded (human-readable) text, persists. On startup it drops rows whose model differs from settings so switching providers never pollutes cosine ranking.
  - Storage gains a model/dim filter on `allEmbeddings()` plus `dropEmbeddingsWhereModelNot`, `countObservations`, `countEmbeddings`, and a model-scoped variant of `observationsMissingEmbeddings`.
  - The `Embedder` interface in `@cavemem/core` now exposes `model` and `dim` so the store can reject mismatched rows before cosine computation.
  - Both the CLI `search` command and the MCP `search` tool instantiate the embedder lazily and pass it into `MemoryStore.search`. Semantic search is on by default; `cavemem search --no-semantic` bypasses it.
  - Worker writes a `worker.state.json` snapshot after every batch so `cavemem status` can show "embedded 124 / 200 (62%)" without hitting HTTP.

  **Lifecycle (previously unclear) is now ergonomic**

  - Hooks auto-spawn the worker detached + pidfile-guarded when it is not running (fast path < 2 ms; full `stat` + `process.kill(pid, 0)` probe). Respects `CAVEMEM_NO_AUTOSTART` for deterministic tests. Skipped when `embedding.autoStart=false` or `provider=none`.
  - Worker idle-exits after `embedding.idleShutdownMs` (default 10 min) of no embed work and no viewer traffic. No launchd/systemd integration needed.
  - New top-level `cavemem start`, `cavemem stop`, `cavemem restart`, and `cavemem viewer` commands — thin wrappers around the existing pidfile-managing implementation.

  **Config UX**

  - New `cavemem status` top-level command: single-pane dashboard showing settings path, data dir, DB counts, installed IDEs, embedding provider/model, backfill progress, worker pid and uptime.
  - New `cavemem config show|get|set|open|path|reset` command backed by zod `.describe()` — the schema is self-documenting; no parallel docs to maintain.
  - New `settingsDocs()` export from `@cavemem/config` returns `[{path, type, default, description}]` for every field.
  - `cavemem install` now prints a multi-line "what to try next" block explaining that there is no daemon to start, and surfaces the embedding model + weight-download cost.
  - Settings schema gains `embedding.batchSize`, `embedding.autoStart`, and `embedding.idleShutdownMs` — every field now has a `.describe(...)` string.

  **MCP server**

  - Lazy-singleton embedder resolution — MCP handshake stays fast; model loads on first `search` tool call.
  - New `list_sessions` tool.

  **Non-negotiable rule update**

  - CLAUDE.md now documents the "no daemon on the write path" invariant: hooks may detach-spawn the worker but must never wait on it; observations write synchronously.

### Patch Changes

- Updated dependencies [416957b]
  - @cavemem/config@0.2.0
