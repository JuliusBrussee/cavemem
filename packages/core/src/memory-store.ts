import { compress, expand, redactPrivate } from '@cavemem/compress';
import type { Settings } from '@cavemem/config';
import { type NewObservation, type ObservationRow, Storage } from '@cavemem/storage';
import { cosine, hybridRank } from './ranker.js';
import type { GetObservationsOptions, Observation, SearchResult } from './types.js';

export interface MemoryStoreOptions {
  dbPath: string;
  settings: Settings;
}

/**
 * Facade over storage + compression. All write paths go through here to
 * enforce: redact private tags → compress → persist.
 */
export class MemoryStore {
  readonly storage: Storage;
  readonly settings: Settings;
  currentCwd: string | null;

  constructor(opts: MemoryStoreOptions) {
    this.storage = new Storage(opts.dbPath);
    this.settings = opts.settings;
    this.currentCwd = null;
  }

  close(): void {
    this.storage.close();
  }

  // --- sessions ---

  startSession(p: { id: string; ide: string; cwd: string | null }): void {
    this.currentCwd = p.cwd;
    this.storage.createSession({
      id: p.id,
      ide: p.ide,
      cwd: p.cwd,
      started_at: Date.now(),
      metadata: null,
    });
  }

  endSession(id: string): void {
    this.storage.endSession(id);
  }

  // --- observations ---

  addObservation(p: {
    session_id: string;
    kind: string;
    content: string;
    metadata?: Record<string, unknown>;
  }): number {
    const redacted = redactPrivate(p.content);
    if (!redacted.trim()) return -1;
    this.ensureSession(p.session_id);
    const intensity = this.settings.compression.intensity;
    const compressed = compress(redacted, { intensity });
    const obs: NewObservation = {
      session_id: p.session_id,
      kind: p.kind,
      content: compressed,
      compressed: true,
      intensity,
      ...(p.metadata !== undefined ? { metadata: p.metadata } : {}),
    };
    return this.storage.insertObservation(obs);
  }

  addSummary(p: { session_id: string; scope: 'turn' | 'session'; content: string }): number {
    const redacted = redactPrivate(p.content);
    this.ensureSession(p.session_id);
    const intensity = this.settings.compression.intensity;
    const out = compress(redacted, { intensity });
    return this.storage.insertSummary({
      session_id: p.session_id,
      scope: p.scope,
      content: out,
      compressed: true,
      intensity,
    });
  }

  /**
   * Idempotently materialise a sessions row before inserting child rows.
   * Claude Code does not guarantee that SessionStart fires before the first
   * UserPromptSubmit / PostToolUse — for example when cavemem is installed
   * mid-session, when a hook earlier in the chain fails, or when a user
   * resumes a session whose SessionStart was lost. Without this guard,
   * observations and summaries hit `FOREIGN KEY constraint failed`.
   */
  private ensureSession(id: string): void {
    this.storage.createSession({
      id,
      ide: 'unknown',
      cwd: null,
      started_at: Date.now(),
      metadata: null,
    });
  }

  // --- reads ---

  getObservations(ids: number[], opts: GetObservationsOptions = {}): Observation[] {
    const want = opts.expand ?? this.settings.compression.expandForModel;
    return this.storage.getObservations(ids).map((r) => toObservation(r, want));
  }

  timeline(sessionId: string, aroundId?: number, limit?: number): Observation[] {
    return this.storage
      .timeline(sessionId, aroundId, limit)
      .map((r) => toObservation(r, /* expand */ false));
  }

  // --- search ---

  async search(query: string, limit?: number, embedder?: Embedder): Promise<SearchResult[]> {
    const cap = limit ?? this.settings.search.defaultLimit;
    const alpha = this.settings.search.alpha;
    const keyword = this.storage.searchFts(query, cap * 2, this.currentCwd);
    if (!embedder || this.settings.embedding.provider === 'none') {
      return keyword.slice(0, cap);
    }
    const vectors = this.storage.allEmbeddings({ model: embedder.model, dim: embedder.dim });
    if (vectors.length === 0) return keyword.slice(0, cap);
    const qvec = await embedder.embed(query);
    if (qvec.length !== embedder.dim) {
      // Provider lied about dim — skip vector ranking rather than mix dims.
      return keyword.slice(0, cap);
    }
    const scored = vectors.map((v) => ({
      id: v.observation_id,
      cosine: cosine(qvec, v.vec),
    }));
    const merged = new Map<number, { bm25?: number; cosine?: number }>();
    for (const k of keyword) merged.set(k.id, { bm25: k.score });
    for (const s of scored) {
      const cur = merged.get(s.id) ?? {};
      cur.cosine = s.cosine;
      merged.set(s.id, cur);
    }
    const ranked = hybridRank(
      Array.from(merged, ([id, v]) => ({ id, ...v })),
      alpha,
    ).slice(0, cap);
    const infoById = new Map<number, { session_id: string; snippet: string; ts: number }>(
      keyword.map((k) => [k.id, { session_id: k.session_id, snippet: k.snippet, ts: k.ts }]),
    );
    // For vector-only hits we still need snippet/session info; fetch them.
    const missing = ranked.filter((r) => !infoById.has(r.id)).map((r) => r.id);
    if (missing.length) {
      for (const row of this.storage.getObservations(missing)) {
        infoById.set(row.id, {
          session_id: row.session_id,
          snippet: row.content.slice(0, 120),
          ts: row.ts,
        });
      }
    }
    return ranked.map((r) => {
      const info = infoById.get(r.id);
      return {
        id: r.id,
        session_id: info?.session_id ?? '',
        snippet: info?.snippet ?? '',
        score: r.score,
        ts: info?.ts ?? 0,
      };
    });
  }
}

export interface Embedder {
  readonly model: string;
  readonly dim: number;
  embed(text: string): Promise<Float32Array>;
}

function toObservation(r: ObservationRow, expandText: boolean): Observation {
  const raw = r.content;
  const content = expandText ? expand(raw) : raw;
  return {
    id: r.id,
    session_id: r.session_id,
    kind: r.kind,
    content,
    compressed: !expandText && r.compressed === 1,
    intensity: r.intensity,
    ts: r.ts,
    metadata: r.metadata ? safeParse(r.metadata) : null,
  };
}

function safeParse(s: string): Record<string, unknown> | null {
  try {
    return JSON.parse(s) as Record<string, unknown>;
  } catch {
    return null;
  }
}
