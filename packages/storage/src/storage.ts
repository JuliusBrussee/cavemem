import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { SCHEMA_SQL } from './schema.js';
import type {
  NewObservation,
  NewSummary,
  ObservationRow,
  SearchHit,
  SessionRow,
  SummaryRow,
} from './types.js';

export interface StorageOptions {
  readonly?: boolean;
}

export class Storage {
  private db: Database.Database;

  constructor(dbPath: string, opts: StorageOptions = {}) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath, opts.readonly ? { readonly: true } : {});
    this.db.exec(SCHEMA_SQL);
  }

  close(): void {
    this.db.close();
  }

  // --- sessions ---

  createSession(s: Omit<SessionRow, 'ended_at'>): void {
    this.db
      .prepare('INSERT INTO sessions(id, ide, cwd, started_at, metadata) VALUES (?, ?, ?, ?, ?)')
      .run(s.id, s.ide, s.cwd, s.started_at, s.metadata);
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
    const half = Math.floor(limit / 2);
    return this.db
      .prepare(
        `SELECT * FROM (
           SELECT * FROM observations WHERE session_id = ? AND id <= ? ORDER BY id DESC LIMIT ?
         ) UNION SELECT * FROM observations WHERE session_id = ? AND id > ? ORDER BY id LIMIT ?`,
      )
      .all(sessionId, aroundId, half, sessionId, aroundId, half) as ObservationRow[];
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

  searchFts(query: string, limit = 10): SearchHit[] {
    if (!query.trim()) return [];
    const rows = this.db
      .prepare(
        `SELECT o.id, o.session_id, o.ts,
                snippet(observations_fts, 0, '[', ']', '…', 16) AS snippet,
                bm25(observations_fts) AS score
         FROM observations_fts
         JOIN observations o ON o.id = observations_fts.rowid
         WHERE observations_fts MATCH ?
         ORDER BY score ASC
         LIMIT ?`,
      )
      .all(sanitizeMatch(query), limit) as Array<{
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

  allEmbeddings(): Array<{ observation_id: number; vec: Float32Array }> {
    const rows = this.db.prepare('SELECT observation_id, dim, vec FROM embeddings').all() as Array<{
      observation_id: number;
      dim: number;
      vec: Buffer;
    }>;
    return rows.map((r) => ({
      observation_id: r.observation_id,
      vec: new Float32Array(r.vec.buffer, r.vec.byteOffset, r.dim),
    }));
  }

  observationsMissingEmbeddings(limit = 100): ObservationRow[] {
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
}

function sanitizeMatch(q: string): string {
  // Escape double quotes and wrap each bare term to avoid FTS5 syntax errors.
  return q
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `"${t.replace(/"/g, '""')}"`)
    .join(' ');
}
