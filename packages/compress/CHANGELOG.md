# @cavemem/compress

## 0.3.0

### Minor Changes

- dec94ef: Opt-in web-search enrichment MCP tool (#55), phase 1.

  - **config (#55):** New `enrich` settings block: `enrich.enabled` (default `false`), `enrich.maxResults` (default 3, max 5), `enrich.timeoutMs` (default 8000). Off by default — when off, the enrich MCP tool is not registered and no network call is ever made. Picked up automatically by `cavemem config show` / `settingsDocs()`.
  - **compress (#55):** New `redactSecrets(text)` export that masks common API-key shapes (OpenAI/Stripe `sk-…`, GitHub `ghp_`/`github_pat_`, AWS `AKIA…`, Slack `xox…`) as `[REDACTED]`. Gated by `settings.privacy.redactSecrets` at call sites.
  - **mcp-server (#55):** New `enrich(query, note?)` tool, registered only when `enrich.enabled` is `true`. Searches DuckDuckGo's HTML endpoint (no API key), parses the top results with a hand-rolled linear-time parser, fetches each result page with a 500 KB byte cap and per-request timeout, strips it to plain text, and truncates to 2000 chars. Extracts are stored through `MemoryStore.addObservation` (compressed, privacy-redacted) under a dedicated synthetic `enrich` session, tagged `metadata: { source: 'web', url, query, note? }` for provenance; `query`/`note` are run through `redactPrivate` + `redactSecrets` before storage, and source URLs survive compression byte-for-byte. The tool returns `{ query, results: [{ title, url, extract, observation_id }], stored_ids }`. **SSRF-hardened:** every fetched URL and each manually-followed redirect hop (max 3) must be http(s) to a public host — loopback, RFC1918, link-local (`169.254/16`), and unique-local targets (including obfuscated numeric literals) are rejected without a request. Search failure returns an MCP error with nothing stored; individual blocked or dead result pages are skipped.

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
