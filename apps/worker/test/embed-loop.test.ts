import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SettingsSchema } from '@cavemem/config';
import { type Embedder, MemoryStore } from '@cavemem/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startEmbedLoop, stateFilePath } from '../src/embed-loop.js';

let dir: string;
let store: MemoryStore;

function buildSettings() {
  return SettingsSchema.parse({
    dataDir: dir,
    embedding: {
      provider: 'local',
      model: 'mock-model',
      batchSize: 8,
      autoStart: false,
      idleShutdownMs: 60_000,
    },
  });
}

function mockEmbedder(model: string, dim: number): Embedder {
  return {
    model,
    dim,
    async embed(_text: string) {
      const v = new Float32Array(dim);
      for (let i = 0; i < dim; i++) v[i] = Math.random();
      return v;
    },
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cavemem-embed-'));
  store = new MemoryStore({ dbPath: join(dir, 'data.db'), settings: buildSettings() });
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('embed loop', () => {
  it('backfills all missing observations and writes a state file', async () => {
    store.startSession({ id: 'sess', ide: 'test', cwd: '/tmp' });
    for (let i = 0; i < 5; i++) {
      store.addObservation({ session_id: 'sess', kind: 'note', content: `observation ${i}` });
    }
    expect(store.storage.countEmbeddings()).toBe(0);

    const handle = startEmbedLoop({
      store,
      embedder: mockEmbedder('mock-model', 4),
      settings: buildSettings(),
      idleTickMs: 20,
    });

    // Wait for at least one batch to run.
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline && store.storage.countEmbeddings() < 5) {
      await new Promise((r) => setTimeout(r, 20));
    }
    await handle.stop();

    expect(store.storage.countEmbeddings()).toBe(5);
    const state = JSON.parse(readFileSync(stateFilePath(buildSettings()), 'utf8')) as {
      embedded: number;
      total: number;
      model: string;
      dim: number;
    };
    expect(state.embedded).toBe(5);
    expect(state.total).toBe(5);
    expect(state.model).toBe('mock-model');
    expect(state.dim).toBe(4);
  });

  it('drops stale-model embeddings on startup', async () => {
    store.startSession({ id: 'sess', ide: 'test', cwd: '/tmp' });
    const a = store.addObservation({ session_id: 'sess', kind: 'note', content: 'a' });
    const b = store.addObservation({ session_id: 'sess', kind: 'note', content: 'b' });
    store.storage.putEmbedding(a, 'old-model', new Float32Array([1, 2]));
    store.storage.putEmbedding(b, 'old-model', new Float32Array([3, 4]));
    expect(store.storage.countEmbeddings()).toBe(2);

    const handle = startEmbedLoop({
      store,
      embedder: mockEmbedder('new-model', 3),
      settings: buildSettings(),
      idleTickMs: 20,
    });

    const deadline = Date.now() + 2000;
    while (
      Date.now() < deadline &&
      store.storage.countEmbeddings({ model: 'new-model', dim: 3 }) < 2
    ) {
      await new Promise((r) => setTimeout(r, 20));
    }
    await handle.stop();

    // Stale rows dropped, new rows created.
    expect(store.storage.countEmbeddings({ model: 'old-model', dim: 2 })).toBe(0);
    expect(store.storage.countEmbeddings({ model: 'new-model', dim: 3 })).toBe(2);
  });

  it('writes state file at a predictable path', () => {
    const p = stateFilePath(buildSettings());
    // File may not exist yet; path must be inside the data dir.
    expect(p.startsWith(dir)).toBe(true);
    expect(p.endsWith('worker.state.json')).toBe(true);
    // exhaust the "does the file path look right?" check regardless of state.
    expect(existsSync(dir)).toBe(true);
  });

  it('idleShutdownMs: 0 disables idle shutdown — never fires onIdleExit', async () => {
    const settings = SettingsSchema.parse({
      dataDir: dir,
      embedding: {
        provider: 'local',
        model: 'mock-model',
        batchSize: 8,
        autoStart: false,
        idleShutdownMs: 0,
      },
    });
    let exited = false;
    const handle = startEmbedLoop({
      store,
      embedder: mockEmbedder('mock-model', 4),
      settings,
      idleTickMs: 20,
      onIdleExit: () => {
        exited = true;
      },
    });

    // Idle immediately (no observations to embed) — wait well past what
    // would have been a shutdown window if idleShutdownMs behaved as > 0.
    await new Promise((r) => setTimeout(r, 200));
    await handle.stop();

    expect(exited).toBe(false);
  });

  it('clamps a negative idleShutdownMs to 0 (disabled)', async () => {
    const settings = SettingsSchema.parse({
      dataDir: dir,
      embedding: {
        provider: 'local',
        model: 'mock-model',
        batchSize: 8,
        autoStart: false,
        idleShutdownMs: -1,
      },
    });
    expect(settings.embedding.idleShutdownMs).toBe(0);

    let exited = false;
    const handle = startEmbedLoop({
      store,
      embedder: mockEmbedder('mock-model', 4),
      settings,
      idleTickMs: 20,
      onIdleExit: () => {
        exited = true;
      },
    });

    await new Promise((r) => setTimeout(r, 200));
    await handle.stop();

    expect(exited).toBe(false);
  });
});
