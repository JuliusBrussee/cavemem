import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expand } from '@cavemem/compress';
import type { Settings } from '@cavemem/config';
import { resolveDataDir } from '@cavemem/config';
import type { Embedder, MemoryStore } from '@cavemem/core';

export interface EmbedLoopState {
  provider: string;
  model: string;
  dim: number;
  embedded: number;
  total: number;
  lastBatchAt: number | null;
  lastBatchMs: number | null;
  lastError: string | null;
  /** Set by the HTTP layer whenever a viewer request hits, so the loop's
   * idle-shutdown considers UI activity as "still wanted". */
  lastHttpAt: number;
  startedAt: number;
}

export interface EmbedLoopHandle {
  /** Stop the loop and wait for the current batch to finish. */
  stop: () => Promise<void>;
  /** Bump the HTTP activity timestamp (call on every request). */
  touch: () => void;
  /** Read the current state snapshot. */
  state: () => EmbedLoopState;
}

export function stateFilePath(settings: Settings): string {
  return join(resolveDataDir(settings.dataDir), 'worker.state.json');
}

/**
 * Run the embedding backfill loop in-process. Writes a snapshot JSON after
 * every batch so `cavemem status` can read it without HTTP.
 *
 * Lifecycle:
 *   1. Drop embeddings rows that don't match the current model/dim.
 *   2. Loop: fetch up-to-batchSize observations without embeddings, embed
 *      the expanded text (semantic search matches human intent, not caveman
 *      grammar), persist.
 *   3. When nothing left, sleep {idleTickMs}. After {idleShutdownMs} with
 *      no embed work and no HTTP traffic, invoke onIdleExit.
 */
export function startEmbedLoop(opts: {
  store: MemoryStore;
  embedder: Embedder;
  settings: Settings;
  onIdleExit?: () => void;
  /** Poll cadence when the queue is empty. Defaults to 2s. */
  idleTickMs?: number;
}): EmbedLoopHandle {
  const { store, embedder, settings } = opts;
  const idleTickMs = opts.idleTickMs ?? 2000;
  const batchSize = settings.embedding.batchSize;
  // 0 (or negative, clamped to 0 here as a defensive second guard on top of
  // the config schema's own clamp) disables idle shutdown — the worker runs
  // until killed.
  const idleShutdownMs = Math.max(0, settings.embedding.idleShutdownMs);

  // Nuke stale-model embeddings once on startup.
  const dropped = store.storage.dropEmbeddingsWhereModelNot(embedder.model);
  if (dropped > 0) {
    process.stderr.write(
      `[cavemem worker] dropped ${dropped} stale embeddings (model switched to ${embedder.model})\n`,
    );
  }

  const state: EmbedLoopState = {
    provider: settings.embedding.provider,
    model: embedder.model,
    dim: embedder.dim,
    embedded: store.storage.countEmbeddings({ model: embedder.model, dim: embedder.dim }),
    total: store.storage.countObservations(),
    lastBatchAt: null,
    lastBatchMs: null,
    lastError: null,
    lastHttpAt: Date.now(),
    startedAt: Date.now(),
  };

  const statePath = stateFilePath(settings);
  let stopped = false;
  let current: Promise<void> | null = null;

  const snapshot = () => {
    try {
      writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    } catch {
      // Best effort — status will just show slightly stale data.
    }
  };
  snapshot();

  const processOnce = async (): Promise<boolean> => {
    const rows = store.storage.observationsMissingEmbeddings(batchSize, embedder.model);
    if (rows.length === 0) return false;
    const t0 = Date.now();
    for (const row of rows) {
      if (stopped) return true;
      try {
        // Expand for semantic fidelity: caveman grammar is lossless but
        // models were trained on natural text, so expand first.
        const text = expand(row.content);
        const vec = await embedder.embed(text);
        store.storage.putEmbedding(row.id, embedder.model, vec);
      } catch (err) {
        state.lastError = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[cavemem worker] embed error row=${row.id}: ${state.lastError}\n`);
        // Don't re-attempt forever — insert a zero vector marker? No, skip this batch
        // and retry on next iteration. If the error is persistent, user will see it in status.
        break;
      }
    }
    state.lastBatchAt = Date.now();
    state.lastBatchMs = state.lastBatchAt - t0;
    state.embedded = store.storage.countEmbeddings({ model: embedder.model, dim: embedder.dim });
    state.total = store.storage.countObservations();
    snapshot();
    return true;
  };

  const run = async () => {
    let idleSince = Date.now();
    while (!stopped) {
      const didWork = await processOnce();
      if (didWork) {
        idleSince = Date.now();
        continue;
      }
      // Refresh total in case observations are being written while we're idle.
      state.total = store.storage.countObservations();
      snapshot();
      const now = Date.now();
      const noWork = now - idleSince;
      const noTraffic = now - state.lastHttpAt;
      if (idleShutdownMs > 0 && noWork > idleShutdownMs && noTraffic > idleShutdownMs) {
        process.stderr.write(
          `[cavemem worker] idle ${Math.round(noWork / 1000)}s + no traffic ${Math.round(
            noTraffic / 1000,
          )}s — exiting\n`,
        );
        opts.onIdleExit?.();
        return;
      }
      await sleep(idleTickMs);
    }
  };

  current = run().catch((err) => {
    state.lastError = err instanceof Error ? err.message : String(err);
    snapshot();
  });

  return {
    stop: async () => {
      stopped = true;
      if (current) await current;
    },
    touch: () => {
      state.lastHttpAt = Date.now();
    },
    state: () => ({ ...state }),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
