import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { SCHEMA_SQL } from './schema.js';
import type {
  NewObservation,
  NewSummary,
  ObservationRow,
  SearchHit,
  SessionRow,
  SummaryRow,
} from './types.js';

// Minimal interface satisfied by both better-sqlite3 (Node) and bun:sqlite (Bun).
interface RunResult {
  lastInsertRowid: number | bigint;
  changes?: number;
}
interface Stmt {
  run(...args: unknown[]): RunResult;
  // Returns undefined (not null) regardless of backend.
  get(...args: unknown[]): unknown;
  all(...args: unknown[]): unknown[];
}
interface DbHandle {
  runSchema(sql: string): void;
  prepare(sql: string): Stmt;
  transaction<T>(fn: () => T): T;
  close(): void;
}

// Inline constructor type — avoids import type + typeof controversy with export= modules.
type Bs3Constructor = new (
  path: string,
  opts?: { readonly?: boolean },
) => {
  exec(sql: string): void;
  prepare(sql: string): unknown;
  transaction(fn: () => unknown): () => unknown;
  close(): void;
};

const _req = createRequire(import.meta.url);
export const isBun = !!(typeof process !== 'undefined' && process.versions && process.versions.bun);

// bun:sqlite returns null on no-match; better-sqlite3 returns undefined.
// Normalise to undefined so callers don't need to know which backend is active.
export function normalizeBunGet(result: unknown): unknown {
  return result === null ? undefined : result;
}

function openDb(dbPath: string, opts: { readonly?: boolean } = {}): DbHandle {
  if (isBun) {
    // bun:sqlite is a Bun built-in; not available on Node.
    const { Database: BunDb } = _req('bun:sqlite') as {
      Database: new (
        path: string,
        opts?: { readonly?: boolean },
      ) => {
        exec(sql: string): void;
        prepare(sql: string): {
          run(...a: unknown[]): { lastInsertRowid: number; changes: number };
          get(...a: unknown[]): unknown;
          all(...a: unknown[]): unknown[];
        };
        close(): void;
      };
    };
    const db = new BunDb(dbPath, opts.readonly ? { readonly: true } : undefined);
    return {
      runSchema: (sql) => db.exec(sql),
      close: () => db.close(),
      prepare: (sql) => {
        const s = db.prepare(sql);
        return {
          run: (...a) => s.run(...a),
          get: (...a) => normalizeBunGet(s.get(...a)),
          all: (...a) => s.all(...a),
        };
      },
      // bun:sqlite has Database.transaction(fn) too, but prepared
      // BEGIN/COMMIT/ROLLBACK keeps the adapter's inline driver type minimal
      // and behaves identically for the non-nested transactions Storage runs.
      transaction: <T>(fn: () => T): T => {
        db.prepare('BEGIN').run();
        try {
          const out = fn();
          db.prepare('COMMIT').run();
          return out;
        } catch (err) {
          db.prepare('ROLLBACK').run();
          throw err;
        }
      },
    };
  }
  // Node: load better-sqlite3 native addon.
  const Db = _req('better-sqlite3') as Bs3Constructor;
  const db = new Db(dbPath, opts.readonly ? { readonly: true } : {});
  return {
    runSchema: (sql) => {
      db.exec(sql);
    },
    prepare: (sql) => db.prepare(sql) as unknown as Stmt,
    transaction: <T>(fn: () => T): T => db.transaction(fn)() as T,
    close: () => db.close(),
  };
}

export interface StorageOptions {
  readonly?: boolean;
}

export class Storage {
  private db: DbHandle;

  constructor(dbPath: string, opts: StorageOptions = {}) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = openDb(dbPath, opts);
    // SCHEMA_SQL ends in a genuine `INSERT OR IGNORE`, which a read-only
    // connection rejects outright even when the row already exists. Readonly
    // mode is only ever used against a database an earlier writable Storage
    // has already initialized (e.g. `cavemem export`), so skip it here.
    if (!opts.readonly) this.db.runSchema(SCHEMA_SQL);
  }

  close(): void {
    this.db.close();
  }

  /**
   * Run `fn` inside a single SQLite transaction. If `fn` throws, every write
   * made inside it is rolled back and the error propagates — `cavemem import`
   * uses this so a mid-file failure leaves the database untouched.
   */
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn);
  }

  // --- sessions ---

  createSession(s: Omit<SessionRow, 'ended_at'>): boolean {
    // INSERT OR IGNORE: SessionStart re-fires on resume/clear/compact with the
    // same session_id, and we want the original row (and ended_at=null) preserved.
    // The boolean return (row inserted vs already present) also gives
    // `cavemem import` merge-by-id idempotency for free.
    const info = this.db
      .prepare(
        'INSERT OR IGNORE INTO sessions(id, ide, cwd, started_at, metadata) VALUES (?, ?, ?, ?, ?)',
      )
      .run(s.id, s.ide, s.cwd, s.started_at, s.metadata);
    return (info.changes ?? 0) > 0;
  }

  endSession(id: string, ts = Date.now()): void {
    this.db.prepare('UPDATE sessions SET ended_at = ? WHERE id = ?').run(ts, id);
  }

  getSession(id: string): SessionRow | undefined {
    return this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | undefined;
  }

  listSessions(limit = 50): SessionRow[] {
    return this.db
      .prepare('SELECT * FROM sessions ORDER BY started_at DESC LIMIT ?')
      .all(limit) as SessionRow[];
  }

  // --- observations ---

  insertObservation(o: NewObservation): number {
    const ts = o.ts ?? Date.now();
    const stmt = this.db.prepare(
      'INSERT INTO observations(session_id, kind, content, compressed, intensity, ts, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    const info = stmt.run(
      o.session_id,
      o.kind,
      o.content,
      o.compressed ? 1 : 0,
      o.intensity,
      ts,
      o.metadata ? JSON.stringify(o.metadata) : null,
    );
    return Number(info.lastInsertRowid);
  }

  /**
   * Insert an observation with an explicit id and its content verbatim —
   * no compression is applied here. This is the sanctioned exception to
   * "all persisted prose goes through MemoryStore, which compresses it":
   * `cavemem import` replays rows whose `content` already passed through
   * `@cavemem/compress` once, on the machine that produced the export.
   * Recompressing on the target machine could produce different bytes if
   * its `compression.intensity` setting differs from the source's, which
   * would break byte-identical export → import → export round-trips.
   *
   * `INSERT OR IGNORE` on the explicit id is the merge-by-id idempotency
   * `cavemem import` needs: re-importing the same file is a no-op. Returns
   * true if the row was inserted, false if an observation with that id
   * already existed (skipped).
   */
  importObservation(o: ObservationRow): boolean {
    const info = this.db
      .prepare(
        'INSERT OR IGNORE INTO observations(id, session_id, kind, content, compressed, intensity, ts, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(o.id, o.session_id, o.kind, o.content, o.compressed, o.intensity, o.ts, o.metadata);
    return (info.changes ?? 0) > 0;
  }

  getObservations(ids: number[]): ObservationRow[] {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    return this.db
      .prepare(`SELECT * FROM observations WHERE id IN (${placeholders})`)
      .all(...ids) as ObservationRow[];
  }

  timeline(sessionId: string, aroundId?: number, limit = 50): ObservationRow[] {
    if (aroundId === undefined) {
      return this.db
        .prepare('SELECT * FROM observations WHERE session_id = ? ORDER BY ts DESC LIMIT ?')
        .all(sessionId, limit) as ObservationRow[];
    }
    // Return up to `limit` rows centred on aroundId — two independent,
    // bounded queries merged in JS so neither side can starve the other.
    // A single UNION with a trailing LIMIT would let the "after" half
    // swallow the whole window.
    const half = Math.max(1, Math.floor(limit / 2));
    const before = this.db
      .prepare(
        'SELECT * FROM observations WHERE session_id = ? AND id <= ? ORDER BY id DESC LIMIT ?',
      )
      .all(sessionId, aroundId, half) as ObservationRow[];
    const after = this.db
      .prepare('SELECT * FROM observations WHERE session_id = ? AND id > ? ORDER BY id ASC LIMIT ?')
      .all(sessionId, aroundId, limit - before.length) as ObservationRow[];
    const seen = new Set<number>();
    const merged: ObservationRow[] = [];
    for (const row of [...before.slice().reverse(), ...after]) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      merged.push(row);
    }
    return merged;
  }

  // --- summaries ---

  insertSummary(s: NewSummary): number {
    const ts = s.ts ?? Date.now();
    const info = this.db
      .prepare(
        'INSERT INTO summaries(session_id, scope, content, compressed, intensity, ts) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(s.session_id, s.scope, s.content, s.compressed ? 1 : 0, s.intensity, ts);
    return Number(info.lastInsertRowid);
  }

  listSummaries(sessionId: string): SummaryRow[] {
    return this.db
      .prepare('SELECT * FROM summaries WHERE session_id = ? ORDER BY ts DESC')
      .all(sessionId) as SummaryRow[];
  }

  // --- search (BM25 via FTS5) ---

  // Rebuilds the FTS5 index from the observations table. Goes through
  // prepare/run (not runSchema/exec) so it works identically on both backends.
  rebuildFts(): void {
    this.db.prepare("INSERT INTO observations_fts(observations_fts) VALUES('rebuild');").run();
  }

  /**
   * BM25 search over the observations FTS index. If `cwd` is supplied, results
   * are restricted to observations whose session was opened in that cwd —
   * scoping search to a single project so memory from project A does not leak
   * into project B (see #39).
   */
  searchFts(query: string, limit = 10, cwd?: string | null): SearchHit[] {
    if (!query.trim()) return [];
    const sql = cwd
      ? `SELECT o.id, o.session_id, o.ts,
                snippet(observations_fts, 0, '[', ']', '…', 16) AS snippet,
                bm25(observations_fts) AS score
         FROM observations_fts
         JOIN observations o ON o.id = observations_fts.rowid
         JOIN sessions s ON s.id = o.session_id
         WHERE observations_fts MATCH ? AND s.cwd = ?
         ORDER BY score ASC
         LIMIT ?`
      : `SELECT o.id, o.session_id, o.ts,
                snippet(observations_fts, 0, '[', ']', '…', 16) AS snippet,
                bm25(observations_fts) AS score
         FROM observations_fts
         JOIN observations o ON o.id = observations_fts.rowid
         WHERE observations_fts MATCH ?
         ORDER BY score ASC
         LIMIT ?`;
    const params = cwd ? [sanitizeMatch(query), cwd, limit] : [sanitizeMatch(query), limit];
    const rows = this.db.prepare(sql).all(...params) as Array<{
      id: number;
      session_id: string;
      ts: number;
      snippet: string;
      score: number;
    }>;
    return rows.map((r) => ({
      id: r.id,
      session_id: r.session_id,
      snippet: r.snippet,
      // FTS5 bm25 is "lower is better". Flip sign so higher = better downstream.
      score: -r.score,
      ts: r.ts,
    }));
  }

  // --- embeddings ---

  putEmbedding(observationId: number, model: string, vec: Float32Array): void {
    const buf = Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
    this.db
      .prepare(
        'INSERT OR REPLACE INTO embeddings(observation_id, model, dim, vec) VALUES (?, ?, ?, ?)',
      )
      .run(observationId, model, vec.length, buf);
  }

  getEmbedding(
    observationId: number,
  ): { model: string; dim: number; vec: Float32Array } | undefined {
    const row = this.db
      .prepare('SELECT model, dim, vec FROM embeddings WHERE observation_id = ?')
      .get(observationId) as { model: string; dim: number; vec: Buffer } | undefined;
    if (!row) return undefined;
    const vec = new Float32Array(row.vec.buffer, row.vec.byteOffset, row.dim);
    return { model: row.model, dim: row.dim, vec };
  }

  allEmbeddings(filter?: { model: string; dim: number }): Array<{
    observation_id: number;
    vec: Float32Array;
  }> {
    const rows = filter
      ? (this.db
          .prepare('SELECT observation_id, dim, vec FROM embeddings WHERE model = ? AND dim = ?')
          .all(filter.model, filter.dim) as Array<{
          observation_id: number;
          dim: number;
          vec: Buffer;
        }>)
      : (this.db.prepare('SELECT observation_id, dim, vec FROM embeddings').all() as Array<{
          observation_id: number;
          dim: number;
          vec: Buffer;
        }>);
    return rows.map((r) => ({
      observation_id: r.observation_id,
      // Copy into a fresh buffer — the underlying Buffer from better-sqlite3
      // is freed after the statement is iterated, so aliasing it into a
      // Float32Array is not safe once the row goes out of scope.
      vec: new Float32Array(
        new Uint8Array(r.vec.buffer, r.vec.byteOffset, r.vec.byteLength).slice().buffer,
      ),
    }));
  }

  observationsMissingEmbeddings(limit = 100, model?: string): ObservationRow[] {
    if (model) {
      return this.db
        .prepare(
          `SELECT o.* FROM observations o
           LEFT JOIN embeddings e ON e.observation_id = o.id AND e.model = ?
           WHERE e.observation_id IS NULL
           ORDER BY o.id DESC
           LIMIT ?`,
        )
        .all(model, limit) as ObservationRow[];
    }
    return this.db
      .prepare(
        `SELECT o.* FROM observations o
         LEFT JOIN embeddings e ON e.observation_id = o.id
         WHERE e.observation_id IS NULL
         ORDER BY o.id DESC
         LIMIT ?`,
      )
      .all(limit) as ObservationRow[];
  }

  /**
   * Remove embeddings whose model does not match the currently configured one.
   * Returns the number of rows deleted. Used on worker startup when the user
   * has switched embedding models — mixed-model cosine returns garbage.
   */
  dropEmbeddingsWhereModelNot(model: string): number {
    const info = this.db.prepare('DELETE FROM embeddings WHERE model != ?').run(model);
    return Number(info.changes ?? 0);
  }

  countObservations(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM observations').get() as { n: number };
    return row.n;
  }

  countEmbeddings(filter?: { model: string; dim: number }): number {
    if (filter) {
      const row = this.db
        .prepare('SELECT COUNT(*) AS n FROM embeddings WHERE model = ? AND dim = ?')
        .get(filter.model, filter.dim) as { n: number };
      return row.n;
    }
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM embeddings').get() as { n: number };
    return row.n;
  }

  lastObservationAt(): number | null {
    const row = this.db.prepare('SELECT MAX(ts) AS t FROM observations').get() as {
      t: number | null;
    };
    return row.t ?? null;
  }
}

// Exported for testing.
export function sanitizeMatch(q: string): string {
  // Escape double quotes and wrap each bare term to avoid FTS5 syntax errors.
  return q
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `"${t.replace(/"/g, '""')}"`)
    .join(' ');
}
