---
'@cavemem/config': minor
'@cavemem/compress': minor
'@cavemem/core': patch
'@cavemem/hooks': patch
'cavemem': minor
---

Wire up the three privacy settings that existed in the schema but had no consumer:

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
