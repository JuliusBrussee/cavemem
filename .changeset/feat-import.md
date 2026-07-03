---
'@cavemem/storage': minor
'cavemem': minor
---

feat(cli,storage): add `cavemem import` to round-trip `cavemem export` output (#33)

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
table is skipped; a free id is used as-is; an id occupied by a *different*
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
