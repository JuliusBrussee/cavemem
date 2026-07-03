# cavemem

## 0.3.0

### Minor Changes

- dec94ef: Opt-in web-search enrichment MCP tool (#55), phase 1.

  - **config (#55):** New `enrich` settings block: `enrich.enabled` (default `false`), `enrich.maxResults` (default 3, max 5), `enrich.timeoutMs` (default 8000). Off by default — when off, the enrich MCP tool is not registered and no network call is ever made. Picked up automatically by `cavemem config show` / `settingsDocs()`.
  - **compress (#55):** New `redactSecrets(text)` export that masks common API-key shapes (OpenAI/Stripe `sk-…`, GitHub `ghp_`/`github_pat_`, AWS `AKIA…`, Slack `xox…`) as `[REDACTED]`. Gated by `settings.privacy.redactSecrets` at call sites.
  - **mcp-server (#55):** New `enrich(query, note?)` tool, registered only when `enrich.enabled` is `true`. Searches DuckDuckGo's HTML endpoint (no API key), parses the top results with a hand-rolled linear-time parser, fetches each result page with a 500 KB byte cap and per-request timeout, strips it to plain text, and truncates to 2000 chars. Extracts are stored through `MemoryStore.addObservation` (compressed, privacy-redacted) under a dedicated synthetic `enrich` session, tagged `metadata: { source: 'web', url, query, note? }` for provenance; `query`/`note` are run through `redactPrivate` + `redactSecrets` before storage, and source URLs survive compression byte-for-byte. The tool returns `{ query, results: [{ title, url, extract, observation_id }], stored_ids }`. **SSRF-hardened:** every fetched URL and each manually-followed redirect hop (max 3) must be http(s) to a public host — loopback, RFC1918, link-local (`169.254/16`), and unique-local targets (including obfuscated numeric literals) are rejected without a request. Search failure returns an MCP error with nothing stored; individual blocked or dead result pages are skipped.

- 2db720f: feat(cli,storage): add `cavemem import` to round-trip `cavemem export` output (#33)

  `cavemem export` had no matching `import`, so cross-device transfer (export
  JSONL on machine A, load it on machine B) was a manual JSON-massaging
  exercise. `cavemem import <file.jsonl> [--dry-run]` now round-trips exactly
  what export emits — `session` and `observation` records; export does not
  emit summaries, so import doesn't need to either.

  Sessions merge by id: a session whose id already exists in the target
  database is skipped and counted. Observation ids are per-machine
  AUTOINCREMENT values with no cross-device coordination — machine A's id=42
  and machine B's id=42 are routinely different observations — so the new
  `Storage.importObservation` treats the exported id as a preference, not an
  identity: an exact (session_id, ts, content) duplicate anywhere in the
  table is skipped; a free id is used as-is; an id occupied by a _different_
  observation gets a fresh AUTOINCREMENT id and is counted as "reassigned".
  Nothing is ever overwritten, and re-running the same import is a no-op even
  after a previous run reassigned ids. The summary line reports
  imported/skipped/reassigned counts. Sessions referenced by observations are
  imported first (or a minimal session row is synthesized as a defensive
  fallback), so the `observations.session_id` foreign key never rejects a
  valid row.

  The whole file is validated up front — a malformed line aborts with a
  clear, line-numbered error and writes nothing — and the actual writes run
  inside one SQLite transaction (new `Storage.transaction`, implemented in
  the DbHandle plumbing for both the better-sqlite3 and bun:sqlite backends),
  so a failure partway through also leaves the database untouched.
  `--dry-run` runs the identical write path and rolls back at the end; when
  the target database doesn't exist yet it runs against an in-memory
  database instead, so not even an empty `data.db` is left behind.

  Exported `content` already passed through `@cavemem/compress` on the
  source machine, so import writes it back verbatim (no re-compression)
  rather than through `MemoryStore.addObservation` — recompressing on the
  target could change the bytes if its `compression.intensity` setting
  differs from the source's, which would break byte-identical
  export → import → export round-trips. `Storage.createSession` now returns
  whether the row was inserted or already existed, which import uses for its
  skip counts.

  Imported observations get no `embeddings` row, so they're picked up by the
  worker's embedding backfill loop the same way any newly-added observation
  is; the FTS5 index is kept in sync via the same insert trigger every other
  write path uses. Embedding vectors themselves are never transported.

  Also fixes two latent `cavemem export` bugs found while wiring this up:
  the `Storage` constructor ran schema-init SQL (including a real
  `INSERT OR IGNORE`) even when opened `{ readonly: true }`, which SQLite
  rejects outright on a true read-only connection — export threw for every
  user once the database existed. Readonly mode now skips schema-init, since
  it's only ever used against a database an earlier writable `Storage` has
  already initialized. And exporting with no database at all now exits
  non-zero with a short message instead of an unhandled SQLITE_CANTOPEN.

  README documents the new command and the manual cross-device transfer
  flow (export on A, stop the worker, import on B, restart).

- 7b7662d: Add four new IDE installers (#23, #8, #38, #10)

  - **GitHub Copilot / VS Code** (`--ide copilot`, #23) — full capture+query. Hooks are
    written to a cavemem-owned `~/.copilot/hooks/cavemem.json` (Copilot's payloads are
    Claude-Code-compatible, so existing handlers read them without translation; Copilot
    has no SessionEnd event). MCP is registered in VS Code's user-level `mcp.json`
    (platform-dependent path, root key `servers`, explicit `type: "stdio"`).
  - **Augment Code** (`--ide augment`, #8) — full capture+query via `~/.augment/settings.json`.
    Augment's hook `command` must be a script-file path, so the installer writes thin
    wrapper scripts (`.sh`, or `.cmd` on Windows) into `~/.augment/cavemem-hooks/` that
    exec the CLI. Augment has no UserPromptSubmit event; the Stop hook sets
    `metadata.includeConversationData` because without it the payload carries no
    assistant text and turn-summary capture would silently store nothing. The CLI's
    `hook run` gains an Augment payload shim mapping `conversation_id` → `session_id`,
    `workspace_roots[0]` → `cwd`, and `conversation.agentTextResponse` → `turn_summary`.
  - **Antigravity** (`--ide antigravity`, #38) — query-only (no hooks system). Registers
    MCP in `~/.gemini/config/mcp_config.json` and warns that sessions there capture no
    new observations.
  - **IBM Bob** (`--ide bob`, #10) — query-only. Registers MCP in `~/.bob/mcp.json` with
    the same warning.

  All four merge non-destructively into existing configs, are idempotent on re-install,
  and remove only cavemem-owned entries (plus Augment's wrapper-script dir) on uninstall.

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

- 73c52c3: Enhance OpenCode integration with full-featured bridge plugin

  This changeset:

  1. **Adds `apps/cli/src/opencode-bridge.ts`** — a bundled OpenCode plugin that maps
     opencode events to cavemem hooks (`session-start`, `session-end`,
     `user-prompt-submit`, `post-tool-use`, `stop`). It buffers streaming assistant
     text parts and flushes complete turn summaries, injects a system-prompt
     reminder about available cavemem MCP tools, and retrieves prior-session context
     from the 3 most recent ended sessions via `@cavemem/core`.

  2. **Fixes the OpenCode installer** to:

     - Write the correct `mcp` schema (`type: 'local'`, `command: [...]`,
       `enabled: true`) to `~/.config/opencode/opencode.json`
     - Symlink the bundled `dist/opencode-bridge.js` into
       `~/.config/opencode/plugins/cavemem.js`
     - Register the plugin explicitly in the `plugin` array for clarity
     - Clean up the legacy `~/.opencode/config.json` entry on install and uninstall
     - Honor `XDG_CONFIG_HOME`

  3. **Ships the bridge** — `apps/cli/tsup.config.ts` gains an `opencodeBridge`
     entry so `dist/opencodeBridge.js` is included in the published package.

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

### Patch Changes

- d2d022e: Surface which IDEs actually capture memory vs are query-only (#58)

  Users installing cavemem into Cursor, Gemini CLI, Antigravity, or IBM Bob had no way
  to tell — short of an empty database — that those integrations are MCP query-only:
  hooks never fire, so no new observations are ever captured there. `cavemem status`
  silently listed every installed IDE the same way.

  Each `Installer` now declares `capture: 'full' | 'partial' | 'none'` (plus an optional
  `captureNotes` caveat) reflecting what its `install()` actually wires up: Claude Code,
  OpenCode, Codex CLI, GitHub Copilot, and Augment Code capture observations through
  hooks (OpenCode via its bundled bridge plugin rather than a `hooks.json`-style file;
  Codex and Copilot have no SessionEnd event; Augment has no UserPromptSubmit event).
  Cursor, Gemini CLI, Antigravity, and IBM Bob register MCP only.

  `cavemem status` reads this metadata and annotates query-only IDEs inline —
  `ides: claude-code, antigravity (query-only)` — instead of listing them
  indistinguishably from IDEs that actually fill the database. The README gains an IDE
  capability matrix (capture / query / notes) under Install, with footnotes on
  OpenCode's bridge plugin and the Copilot/Codex/Augment missing-event caveats.

  No behavioral change to any installer's `install()`/`uninstall()` — this is metadata
  and read-side reporting only.

- a52553d: fix(storage,cli): bump better-sqlite3 to ^12.0.0 for Node 26 (#37)

  Node 26 removed three V8 C++ APIs (`v8::Object::GetPrototype`,
  `v8::Context::GetIsolate`, `v8::PropertyCallbackInfo<T>::This`) that
  better-sqlite3 ≤11.x relied on, so `npm install -g cavemem` fails with
  `error C2039: 'GetPrototype': is not a member of 'v8::Object'` when there
  is no prebuilt binary for the target Node ABI. better-sqlite3 v12 rewrites
  those call sites and ships prebuilts for Node 20 through 26. The Storage
  API surface used by this repo (`prepare`, `run`, `get`, `all`, `exec`,
  FTS5, `bm25`, `snippet`, blob storage) is identical across v11 → v12, so
  no code changes are needed.

- 252ce18: fix(cli): ship optionalDependencies in the legacy pack-release flow

  `pack-release.mjs` rebuilt the published `package.json` from a hardcoded
  allowlist that only read `dependencies`, silently dropping
  `optionalDependencies` — so a `pnpm publish:release` tarball could never
  install `@huggingface/transformers` and the local embedding provider was
  dead on arrival for that publish path. The CI `changeset publish` path was
  unaffected. Optional deps now pass through verbatim.

- 711f5b6: fix(hooks,storage): scope session-start prior-session context to current cwd (#39)

  The `session-start` hook surfaced "Prior-session context" pulled from the
  most recent N sessions across **all** projects on the machine. Opening
  Claude Code in project A could inject summaries from last night's project B
  session into the new kickoff, even though every session row already stores
  `cwd`. Now `session-start.ts` widens the initial lookup from 4 → 20 and
  filters by exact-`cwd` match before picking the top 3, falling back to the
  old global behaviour only when the payload contains no `cwd` (so non-Claude
  Code IDEs are unaffected).

  `Storage.searchFts(query, limit, cwd?)` also gained an optional `cwd`
  parameter that joins `sessions` and restricts hits to that project; default
  behaviour without `cwd` is unchanged.

- 33824f1: fix(cli,hooks): hide Windows console window on detached worker spawn (#11)

  All four detached `child_process.spawn` sites (lifecycle `start`/`viewer`,
  `worker start`, and the hooks auto-spawn path) now pass `windowsHide: true`.
  Without this, `CreateProcess` on Windows pops a visible console window for
  each detached child, which on some setups blocks `cavemem start` and every
  hook auto-spawn. POSIX platforms ignore the option, so no behaviour change
  on macOS/Linux.

- bf71913: fix(installers): quote Windows paths in hook commands even without spaces (#41)

  `shellQuote` previously treated `\` as a bare-token character, so a default
  Windows install path with no spaces was written unquoted into the hook
  `command` string in `~/.claude/settings.json`. When Claude Code on Windows
  runs the hook through MSYS-bash, unquoted backslashes are treated as escape
  introducers and stripped, mangling the path
  `C:\Users\...\node_modules\cavemem\dist\index.js` into
  `CUsers...node_modulescavememdistindex.js` and the hook fails with
  `MODULE_NOT_FOUND`. After this fix, any path containing a backslash gets
  wrapped in double quotes; both cmd.exe and MSYS-bash preserve the
  backslashes verbatim inside `"..."`. POSIX paths are unaffected.

- 69965ea: fix(cli,installers): warn loudly when `sh` is missing on Windows (#56, #57)

  Claude Code wraps hook `command` strings in `sh -c` even on Windows. If Git
  for Windows' `Git\bin` isn't on the user's `Path`, `sh` doesn't resolve,
  every hook fails non-blocking, and cavemem silently stops capturing memory —
  `cavemem doctor` and `cavemem status` kept reporting healthy because the
  failure never reached the CLI (#56).

  `checkWindowsSh()` (new, `@cavemem/installers`) checks `sh` resolvability on
  win32 with an injectable resolver for testing; it's a no-op on every other
  platform. `cavemem doctor` now runs it and exits non-zero with a loud
  warning + the one-time fix (`C:\Program Files\Git\bin`, or the Scoop
  `usr\bin` equivalent, onto user `Path`; verify with `where.exe sh`).
  `cavemem install --ide claude-code` runs the same check and prints the same
  warning, but does not refuse to install — the user may fix `Path` afterward
  and hooks will start working without a re-install.

  **#57 (pwsh emission):** investigated switching the emitted hook `command`
  to Claude Code's newer `shell` field (`"bash"` / `"powershell"`) or its
  shell-free `args` exec form. Held off: we can't verify either against every
  installed Claude Code version, and the current command has no shell
  metacharacters, so it already tokenizes identically whether Claude Code
  runs it through `sh` or falls back to PowerShell. The #56 fix above — make
  the missing-`sh` failure loud instead of silent — is the actionable part we
  could ship with confidence. See the Windows note in the README and the
  comment in `packages/installers/src/claude-code.ts` for the full reasoning.

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

## 0.2.1

### Patch Changes

- c756051: fix(mcp): boot stdio server when invoked via `cavemem mcp`

  The CLI's `mcp` subcommand did `await import('@cavemem/mcp-server')` expecting
  the import side-effect to start the server, but the server module guards
  `main()` behind an `isMainEntry()` check. When dynamically imported,
  `import.meta.url` does not match `process.argv[1]` (the CLI), so `main()`
  never ran and no MCP tools were exposed to the host IDE. Export `main()` from
  the server module and have the CLI call it explicitly. The `isMainEntry()`
  guard remains so the `cavemem-mcp` bin still works when invoked directly.

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

- 99ca440: Fix the Claude Code hook integration end-to-end and harden the npm publish path. With these changes the memory system actually works after `npm install -g cavemem` — verified by the new `scripts/e2e-publish.sh` test that packs the artifact, installs it into an isolated prefix, and drives every hook event with realistic Claude Code payloads.

  **Hook protocol**

  - Handlers now read the field names Claude Code actually sends — `tool_name`, `tool_response`, `last_assistant_message`, `source`, `reason` — while keeping the legacy aliases (`tool`, `tool_output`, `turn_summary`) for non-Claude IDEs and existing tests.
  - The CLI no longer dumps internal telemetry JSON onto stdout. That JSON was being injected verbatim into the agent's context as `additionalContext` for `SessionStart` / `UserPromptSubmit`. Telemetry now goes to stderr; stdout carries Claude Code's `{ "hookSpecificOutput": { "hookEventName": "...", "additionalContext": "..." } }` shape only when there is real context to surface.
  - `Storage.createSession` is now `INSERT OR IGNORE`, and `SessionStart` skips the prior-session preface for non-startup sources, so resume / clear / compact no longer crash with PK conflicts.
  - The Claude Code installer writes `cavemem hook run <name> --ide claude-code`, and the CLI's `hook run` accepts `--ide` so handlers know who invoked them (Claude Code itself never sends an `ide` field).

  **Publishable artifact**

  - `cavemem` no longer lists the private `@cavemem/mcp-server` and `@cavemem/worker` packages as runtime dependencies. Tsup already bundles every `@cavemem/*` module via `noExternal`, so the workspace deps moved to `devDependencies` and `npm install cavemem` resolves cleanly.
  - The bin entrypoint guard (`isMainEntry()`) now compares realpaths via `pathToFileURL(realpathSync(...))`, so the binary works when invoked through npm's symlinked `bin/` shim — previously `--version` and every other command silently exited 0 with no output.
  - Tsup's `banner` option was producing two `#!/usr/bin/env node` lines in every dynamic-import chunk (one from the source file, one from the banner), which broke `cavemem mcp` with `SyntaxError: Invalid or unexpected token`. The banner is gone; the shebang lives in the source files that need it.
  - A new `prepublishOnly` script (`apps/cli/scripts/prepack.mjs`) stages `README.md`, `LICENSE`, and `hooks-scripts/` into `apps/cli/` so `changeset publish` produces a complete tarball. The script no-ops outside the source repo so installing the tarball never re-runs it.
  - The root workspace package was renamed from `cavemem` to `cavemem-monorepo` (still `private:true`) to remove a name collision that caused `pnpm --filter cavemem` to match the root instead of the publishable cli package.

  **CI**

  - The release workflow now runs all four gates (`pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`) and the new `bash scripts/e2e-publish.sh` end-to-end check before `changeset publish` is allowed to publish.

- 7278a69: Fix `spawn EFTYPE` on Windows and unblock installs on Windows end-to-end.

  **Root cause**

  The CLI's `process.argv[1]` (and everything `resolveCliPath()` derives from it) is the `.js` entry file, not a native executable. Node's `child_process.spawn` cannot exec a raw `.js` on Windows — it has no associated binfmt handler, so the launcher bubbles up `EFTYPE`. Every background code path that self-spawned the CLI — `cavemem start`, `cavemem restart`, `cavemem viewer`, and the hook auto-spawn in `@cavemem/hooks` — hit this, so the worker never started and hooks stayed degraded with no embeddings. The installers then wrote the same bad shape into IDE configs (`command: <cliPath.js>` for MCP servers; `"<cliPath.js> hook run …"` as a shell string for Claude Code hooks), so even opening Claude Code / Cursor / Codex / Gemini / OpenCode could not launch the CLI.

  **Fix**

  - Every internal `spawn(cli, [...])` now spawns `process.execPath` with the CLI path as the first arg — cross-platform and does not rely on the OS knowing how to exec a `.js`.
  - `InstallContext` gains a required `nodeBin` field (populated with `process.execPath`). All five installers write `command: nodeBin, args: [cliPath, "mcp", ...]` instead of `command: cliPath, args: ["mcp"]`.
  - The Claude Code installer's hook command strings are now `"<nodeBin>" "<cliPath>" hook run <name> --ide claude-code`, with paths wrapped via a new `shellQuote` helper so `C:\Program Files\nodejs\node.exe` and `C:\Users\Some User\...\index.js` survive both cmd.exe and sh without splitting.
  - Added a Windows-path regression test in `packages/installers/test/installers.test.ts` so the quoting stays correct.

  **Upgrade note**

  Existing Windows installs still have the broken shape written into `~/.claude/settings.json`, `~/.cursor/mcp.json`, etc. After upgrading, run `cavemem install` (and `cavemem install --ide cursor`, etc.) once to rewrite those files with the corrected `nodeBin + cliPath` form. Nothing else changes for macOS and Linux users.

- 4af0d0d: Build, lint, and test-ecosystem fixes:

  - Drop `incremental: true` from the base tsconfig so `tsup --dts` stops failing with TS5074 and `pnpm build` is green again.
  - Resolve the full Biome lint backlog (organizeImports, useImportType) across every package. `pnpm lint` is now clean.
  - Fix a compression bug where `collapseWhitespace` would eat the single space between prose and preserved tokens (paths, inline code, URLs), producing unreadable output like `at/tmp/foo.txt`. Boundary spacing is now preserved on compress and round-tripped through expand.
  - Fix `Storage.timeline(sessionId, aroundId, limit)` — the previous single-UNION query let the "after" half swallow the whole window. Replaced with two bounded queries merged in JS so both halves are respected.
  - Remove a double `expand()` call in the MCP `get_observations` tool; expansion now happens exactly once inside `MemoryStore`.
  - `runHook()` now accepts an injected `MemoryStore` so tests (and other integrations) can avoid touching the user's real `~/.cavemem` data directory.

  Test ecosystem: brand-new suites for `@cavemem/hooks` (runner + all 5 handlers + hot-path budget check), `@cavemem/installers` (claude-code idempotency, settings preservation, cursor install/uninstall, registry, deepMerge), `@cavemem/mcp-server` (InMemory MCP client hitting every tool and asserting the progressive-disclosure shape), `@cavemem/worker` (Hono `app.request()` integration tests for every HTTP route), and the `cavemem` CLI (command registration smoke test). Total tests: 22 → 54.

  None of the new test directories are shipped — every published package keeps its `files` allowlist pointed at `dist` only.
