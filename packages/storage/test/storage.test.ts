import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Storage } from '../src/index.js';

let dir: string;
let storage: Storage;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cavemem-'));
  storage = new Storage(join(dir, 'test.db'));
});

afterEach(() => {
  storage.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('Storage', () => {
  it('stores and retrieves observations', () => {
    storage.createSession({
      id: 'sess-1',
      ide: 'claude-code',
      cwd: '/tmp',
      started_at: Date.now(),
      metadata: null,
    });
    const id = storage.insertObservation({
      session_id: 'sess-1',
      kind: 'note',
      content: 'db config updated',
      compressed: true,
      intensity: 'full',
    });
    const rows = storage.getObservations([id]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.compressed).toBe(1);
  });

  it('opens an existing database in readonly mode without schema writes', () => {
    storage.createSession({
      id: 'readonly-session',
      ide: 'claude-code',
      cwd: '/tmp',
      started_at: 123,
      metadata: null,
    });
    storage.close();

    const readonly = new Storage(join(dir, 'test.db'), { readonly: true });
    try {
      expect(readonly.listSessions().map((s) => s.id)).toContain('readonly-session');
    } finally {
      readonly.close();
    }

    storage = new Storage(join(dir, 'test.db'));
  });

  it('FTS search finds matches', () => {
    storage.createSession({
      id: 's',
      ide: 'claude-code',
      cwd: null,
      started_at: Date.now(),
      metadata: null,
    });
    storage.insertObservation({
      session_id: 's',
      kind: 'note',
      content: 'auth middleware throws 401',
      compressed: true,
      intensity: 'full',
    });
    const hits = storage.searchFts('auth');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.snippet).toContain('[auth]');
  });

  it('stores and retrieves embeddings', () => {
    storage.createSession({
      id: 's2',
      ide: 'claude-code',
      cwd: null,
      started_at: Date.now(),
      metadata: null,
    });
    const id = storage.insertObservation({
      session_id: 's2',
      kind: 'note',
      content: 'x',
      compressed: true,
      intensity: 'full',
    });
    const vec = new Float32Array([0.1, 0.2, 0.3]);
    storage.putEmbedding(id, 'test-model', vec);
    const got = storage.getEmbedding(id);
    expect(got?.dim).toBe(3);
    expect(Array.from(got?.vec)).toEqual([
      expect.closeTo(0.1, 5),
      expect.closeTo(0.2, 5),
      expect.closeTo(0.3, 5),
    ]);
  });

  it('allEmbeddings filters by model + dim', () => {
    storage.createSession({
      id: 's3',
      ide: 'claude-code',
      cwd: null,
      started_at: Date.now(),
      metadata: null,
    });
    const ids: number[] = [];
    for (let i = 0; i < 3; i++) {
      ids.push(
        storage.insertObservation({
          session_id: 's3',
          kind: 'note',
          content: `n${i}`,
          compressed: true,
          intensity: 'full',
        }),
      );
    }
    storage.putEmbedding(ids[0] as number, 'old-model', new Float32Array([1, 2]));
    storage.putEmbedding(ids[1] as number, 'new-model', new Float32Array([1, 2, 3]));
    storage.putEmbedding(ids[2] as number, 'new-model', new Float32Array([4, 5, 6]));

    expect(storage.allEmbeddings().length).toBe(3);
    expect(storage.allEmbeddings({ model: 'new-model', dim: 3 }).length).toBe(2);
    expect(storage.allEmbeddings({ model: 'old-model', dim: 2 }).length).toBe(1);
    expect(storage.allEmbeddings({ model: 'new-model', dim: 2 }).length).toBe(0);
  });

  it('dropEmbeddingsWhereModelNot clears stale rows', () => {
    storage.createSession({
      id: 's4',
      ide: 'claude-code',
      cwd: null,
      started_at: Date.now(),
      metadata: null,
    });
    const a = storage.insertObservation({
      session_id: 's4',
      kind: 'note',
      content: 'a',
      compressed: true,
      intensity: 'full',
    });
    const b = storage.insertObservation({
      session_id: 's4',
      kind: 'note',
      content: 'b',
      compressed: true,
      intensity: 'full',
    });
    storage.putEmbedding(a, 'old-model', new Float32Array([1]));
    storage.putEmbedding(b, 'new-model', new Float32Array([1]));

    const dropped = storage.dropEmbeddingsWhereModelNot('new-model');
    expect(dropped).toBe(1);
    expect(storage.allEmbeddings().length).toBe(1);
  });

  it('observationsMissingEmbeddings respects the model filter', () => {
    storage.createSession({
      id: 's5',
      ide: 'claude-code',
      cwd: null,
      started_at: Date.now(),
      metadata: null,
    });
    const ids: number[] = [];
    for (let i = 0; i < 3; i++) {
      ids.push(
        storage.insertObservation({
          session_id: 's5',
          kind: 'note',
          content: `n${i}`,
          compressed: true,
          intensity: 'full',
        }),
      );
    }
    storage.putEmbedding(ids[0] as number, 'model-a', new Float32Array([1]));

    // No filter: only ids[0] has an embedding at all, so ids[1] and ids[2] are missing.
    expect(
      storage
        .observationsMissingEmbeddings(10)
        .map((r) => r.id)
        .sort(),
    ).toEqual([ids[1], ids[2]].sort());
    // Filter to model-b: ids[0] has no model-b embedding, so all 3 are missing.
    expect(
      storage
        .observationsMissingEmbeddings(10, 'model-b')
        .map((r) => r.id)
        .sort(),
    ).toEqual([ids[0], ids[1], ids[2]].sort());
  });

  it('countObservations + countEmbeddings return correct totals', () => {
    storage.createSession({
      id: 's6',
      ide: 'claude-code',
      cwd: null,
      started_at: Date.now(),
      metadata: null,
    });
    expect(storage.countObservations()).toBe(0);
    const id = storage.insertObservation({
      session_id: 's6',
      kind: 'note',
      content: 'a',
      compressed: true,
      intensity: 'full',
    });
    expect(storage.countObservations()).toBe(1);
    expect(storage.countEmbeddings()).toBe(0);
    storage.putEmbedding(id, 'm', new Float32Array([1]));
    expect(storage.countEmbeddings()).toBe(1);
    expect(storage.countEmbeddings({ model: 'm', dim: 1 })).toBe(1);
    expect(storage.countEmbeddings({ model: 'm', dim: 2 })).toBe(0);
  });
});
