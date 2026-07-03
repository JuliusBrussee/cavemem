# @cavemem/config

## 0.3.0

### Minor Changes

- dec94ef: Opt-in web-search enrichment MCP tool (#55), phase 1.

  - **config (#55):** New `enrich` settings block: `enrich.enabled` (default `false`), `enrich.maxResults` (default 3, max 5), `enrich.timeoutMs` (default 8000). Off by default — when off, the enrich MCP tool is not registered and no network call is ever made. Picked up automatically by `cavemem config show` / `settingsDocs()`.
  - **compress (#55):** New `redactSecrets(text)` export that masks common API-key shapes (OpenAI/Stripe `sk-…`, GitHub `ghp_`/`github_pat_`, AWS `AKIA…`, Slack `xox…`) as `[REDACTED]`. Gated by `settings.privacy.redactSecrets` at call sites.
  - **mcp-server (#55):** New `enrich(query, note?)` tool, registered only when `enrich.enabled` is `true`. Searches DuckDuckGo's HTML endpoint (no API key), parses the top results with a hand-rolled linear-time parser, fetches each result page with a 500 KB byte cap and per-request timeout, strips it to plain text, and truncates to 2000 chars. Extracts are stored through `MemoryStore.addObservation` (compressed, privacy-redacted) under a dedicated synthetic `enrich` session, tagged `metadata: { source: 'web', url, query, note? }` for provenance; `query`/`note` are run through `redactPrivate` + `redactSecrets` before storage, and source URLs survive compression byte-for-byte. The tool returns `{ query, results: [{ title, url, extract, observation_id }], stored_ids }`. **SSRF-hardened:** every fetched URL and each manually-followed redirect hop (max 3) must be http(s) to a public host — loopback, RFC1918, link-local (`169.254/16`), and unique-local targets (including obfuscated numeric literals) are rejected without a request. Search failure returns an MCP error with nothing stored; individual blocked or dead result pages are skipped.

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

- b5976a5: Wire up the three privacy settings that existed in the schema but had no consumer:

  - **config/hooks (#48):** `privacy.excludePatterns` is now enforced in
    `post-tool-use.ts`. A tool call whose `file_path` / `path` / `notebook_path`
    field — or a path-like token embedded in its input/output (e.g. a Bash
    command) — matches an `excludePatterns` glob is skipped entirely; nothing
    about the excluded content is stored or logged. Glob matching (`**` across
    path segments, `*` within a segment) is a hand-rolled linear segment
    matcher (`matchesGlob`) in `@cavemem/config` — no regex construction, so
    repeated-globstar patterns cannot backtrack pathologically, and no new
    dependency. Windows backslash paths are normalized to `/` before matching.
  - **compress/core (#49):** `redactSecrets` was a documented setting with no
    effect. Added `redactSecrets(text)` to `@cavemem/compress`, scrubbing
    Bearer tokens, OpenAI-style `sk-` keys, AWS `AKIA…` access key ids, GitHub
    `gh[pousr]_` tokens, `key = value` / `key: value` assignments whose key
    name ends in a recognised secret word (`api_key`, `secret`, `token`,
    `password`, `passwd`, `authorization`, or a `_key`/`-key` suffix —
    env-var prefixes like `STRIPE_SECRET_KEY` included), and PEM private key
    blocks with `[REDACTED]` (keeping the leading key name for assignments).
    `MemoryStore.addObservation` and `addSummary` now run it before
    compression when `settings.privacy.redactSecrets` is true (the default),
    independent of the existing `redactPrivate` (`<private>` tag) stripping.
    The schema's `redactSecrets` description previously claimed it stripped
    `<private>` tags — corrected to describe actual secret scrubbing.
  - **config/hooks (#50):** Added `capture.excludeTools` / `capture.includeTools`
    (both default `[]`, same glob semantics as above, e.g. `"mcp__broker__*"`).
    `post-tool-use.ts` consults them before storing: `excludeTools` always wins
    over `includeTools`; a non-empty `includeTools` makes capture opt-in to
    just those tools.

### Patch Changes

- 6dc2ae5: fix(worker): authenticate the local viewer HTTP API and allow disabling idle shutdown (#51, #32)

  **#51 — unauthenticated worker HTTP API.** The worker's viewer (`127.0.0.1:<workerPort>`)
  served `/api/sessions`, `/api/sessions/:id/observations` (expanded, human-readable
  bodies), and `/api/search` with no auth, reachable by any local process or by a
  malicious web page doing a DNS-rebinding / CSRF fetch. `apps/worker` now applies
  defense in depth on every request:

  - A Host-header allowlist rejects (403) anything but `127.0.0.1:<port>` /
    `localhost:<port>`, closing the DNS-rebinding path.
  - An Origin check rejects (403) any present Origin that isn't
    `http://127.0.0.1:<port>` / `http://localhost:<port>` — no CORS headers are added.
  - `/api/*` now requires `Authorization: Bearer <token>` or `X-Cavemem-Token`. The
    token is generated once with `crypto.randomBytes(32)`, persisted at
    `<dataDir>/worker-token` (mode `0600`), and reused across restarts.

  The plain HTML viewer pages (`/`, `/sessions/:id`) stay token-free for zero-friction
  browsing — the worker injects `window.__CAVEMEM_TOKEN__` into the served HTML so any
  client-side code can call `/api/*` without the user doing anything. `cavemem viewer`
  and `cavemem status` were already file/pid-based and needed no changes; neither
  `apps/cli` nor `packages/hooks` call the worker over HTTP.

  **#32 — no way to disable idle shutdown.** `embedding.idleShutdownMs` previously had
  to be a positive number, so the worker always self-exited after being idle. Setting
  it to `0` now disables idle shutdown entirely (the worker runs until killed);
  negative values are clamped to `0`.

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
