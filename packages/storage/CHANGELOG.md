# @cavemem/storage

## 0.3.0

### Minor Changes

- 8367404: Add bun:sqlite backend so cavemem runs natively under Bun without the better-sqlite3 native addon.

  When the process is Bun, `openDb` loads `bun:sqlite` via `createRequire` at runtime and
  wraps it in the same `DbHandle` interface used by the better-sqlite3 path. The adapter
  normalises the two API differences: `get()` returning `null` vs `undefined` on no-match,
  and the absence of `{ readonly: false }` support on bun:sqlite. All SQL — FTS5, bm25,
  snippet, binary blob storage — is identical across both backends. No package.json change
  is needed; `bun:sqlite` is a Bun built-in. Node users are unaffected.

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

### Patch Changes

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

- 4af0d0d: Build, lint, and test-ecosystem fixes:

  - Drop `incremental: true` from the base tsconfig so `tsup --dts` stops failing with TS5074 and `pnpm build` is green again.
  - Resolve the full Biome lint backlog (organizeImports, useImportType) across every package. `pnpm lint` is now clean.
  - Fix a compression bug where `collapseWhitespace` would eat the single space between prose and preserved tokens (paths, inline code, URLs), producing unreadable output like `at/tmp/foo.txt`. Boundary spacing is now preserved on compress and round-tripped through expand.
  - Fix `Storage.timeline(sessionId, aroundId, limit)` — the previous single-UNION query let the "after" half swallow the whole window. Replaced with two bounded queries merged in JS so both halves are respected.
  - Remove a double `expand()` call in the MCP `get_observations` tool; expansion now happens exactly once inside `MemoryStore`.
  - `runHook()` now accepts an injected `MemoryStore` so tests (and other integrations) can avoid touching the user's real `~/.cavemem` data directory.

  Test ecosystem: brand-new suites for `@cavemem/hooks` (runner + all 5 handlers + hot-path budget check), `@cavemem/installers` (claude-code idempotency, settings preservation, cursor install/uninstall, registry, deepMerge), `@cavemem/mcp-server` (InMemory MCP client hitting every tool and asserting the progressive-disclosure shape), `@cavemem/worker` (Hono `app.request()` integration tests for every HTTP route), and the `cavemem` CLI (command registration smoke test). Total tests: 22 → 54.

  None of the new test directories are shipped — every published package keeps its `files` allowlist pointed at `dist` only.

- Updated dependencies [416957b]
  - @cavemem/config@0.2.0
