---
'@cavemem/storage': minor
---

Add bun:sqlite backend so cavemem runs natively under Bun without the better-sqlite3 native addon.

When the process is Bun, `openDb` loads `bun:sqlite` via `createRequire` at runtime and
wraps it in the same `DbHandle` interface used by the better-sqlite3 path. The adapter
normalises the two API differences: `get()` returning `null` vs `undefined` on no-match,
and the absence of `{ readonly: false }` support on bun:sqlite. All SQL — FTS5, bm25,
snippet, binary blob storage — is identical across both backends. No package.json change
is needed; `bun:sqlite` is a Bun built-in. Node users are unaffected.
