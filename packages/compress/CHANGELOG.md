# @cavemem/compress

## 0.2.0

### Patch Changes

- 4af0d0d: Build, lint, and test-ecosystem fixes:

  - Drop `incremental: true` from the base tsconfig so `tsup --dts` stops failing with TS5074 and `pnpm build` is green again.
  - Resolve the full Biome lint backlog (organizeImports, useImportType) across every package. `pnpm lint` is now clean.
  - Fix a compression bug where `collapseWhitespace` would eat the single space between prose and preserved tokens (paths, inline code, URLs), producing unreadable output like `at/tmp/foo.txt`. Boundary spacing is now preserved on compress and round-tripped through expand.
  - Fix `Storage.timeline(sessionId, aroundId, limit)` — the previous single-UNION query let the "after" half swallow the whole window. Replaced with two bounded queries merged in JS so both halves are respected.
  - Remove a double `expand()` call in the MCP `get_observations` tool; expansion now happens exactly once inside `MemoryStore`.
  - `runHook()` now accepts an injected `MemoryStore` so tests (and other integrations) can avoid touching the user's real `~/.cavemem` data directory.

  Test ecosystem: brand-new suites for `@cavemem/hooks` (runner + all 5 handlers + hot-path budget check), `@cavemem/installers` (claude-code idempotency, settings preservation, cursor install/uninstall, registry, deepMerge), `@cavemem/mcp-server` (InMemory MCP client hitting every tool and asserting the progressive-disclosure shape), `@cavemem/worker` (Hono `app.request()` integration tests for every HTTP route), and the `cavemem` CLI (command registration smoke test). Total tests: 22 → 54.

  None of the new test directories are shipped — every published package keeps its `files` allowlist pointed at `dist` only.
