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

Merge semantics are by id: a session or observation whose id already exists
in the target database is skipped and counted, so re-running the same
import is a no-op. Observations reference sessions are imported first (or a
minimal session row is synthesized as a defensive fallback if one is
missing), so the `observations.session_id` foreign key never rejects a
valid row. The whole file is validated up front — a malformed line aborts
with a clear, line-numbered error and writes nothing — and the actual
writes run inside one SQLite transaction (`Storage.transaction`), so a
failure partway through also leaves the database untouched. `--dry-run`
runs the identical write path and rolls back at the end, so its reported
counts are exactly what a real import would do.

Exported `content` already passed through `@cavemem/compress` on the
source machine. Import writes it back verbatim via a new
`Storage.importObservation` (explicit id, no re-compression) rather than
through `MemoryStore.addObservation` — recompressing on the target could
change the bytes if its `compression.intensity` setting differs from the
source's, which would break byte-identical export → import → export
round-trips. `Storage.createSession` now returns whether the row was
inserted or already existed, which import uses for its skip counts.

Imported observations get no `embeddings` row, so they're picked up by the
worker's embedding backfill loop the same way any newly-added observation
is; the FTS5 index is kept in sync via the same insert trigger every other
write path uses. Embedding vectors themselves are never transported.

Also fixes a latent bug found while wiring this up: `Storage`'s
constructor ran schema-init SQL (including a real `INSERT OR IGNORE`)
even when opened `{ readonly: true }`, which SQLite rejects outright on a
true read-only connection — this made `cavemem export` throw for every
user once the database already existed. Readonly mode now skips
schema-init, since it's only ever used against a database an earlier
writable `Storage` has already initialized.

README documents the new command and the manual cross-device transfer
flow (export on A, stop the worker, import on B, restart).
