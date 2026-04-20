# @cavemem/storage

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
