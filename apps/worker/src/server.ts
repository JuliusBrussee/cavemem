#!/usr/bin/env node
import { existsSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expand } from '@cavemem/compress';
import { type Settings, loadSettings, resolveDataDir } from '@cavemem/config';
import { MemoryStore } from '@cavemem/core';
import { createEmbedder } from '@cavemem/embedding';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { type EmbedLoopHandle, startEmbedLoop, stateFilePath } from './embed-loop.js';
import { bearerAuth, getOrCreateToken, hostAllowlist, originCheck } from './security.js';
import { renderIndex, renderSession } from './viewer.js';

export interface BuildAppOptions {
  /** Port the worker binds to — used by the Host/Origin allowlist checks. */
  port: number;
  /** Bearer token required on /api/*; also injected into served HTML. */
  token: string;
  loop?: EmbedLoopHandle | undefined;
}

export function buildApp(store: MemoryStore, opts: BuildAppOptions): Hono {
  const app = new Hono();
  const { port, token, loop } = opts;

  // Host/Origin checks apply to every route (kills DNS rebinding + CSRF from
  // browser pages); the bearer token is scoped to /api/* only so the plain
  // HTML pages keep loading with zero user friction.
  app.use('*', hostAllowlist(port));
  app.use('*', originCheck(port));
  app.use('*', async (_c, next) => {
    loop?.touch();
    await next();
  });
  app.use('/api/*', bearerAuth(token));

  app.get('/healthz', (c) => c.json({ ok: true }));

  app.get('/api/state', (c) => {
    if (!loop) return c.json({ running: false });
    return c.json({ running: true, ...loop.state() });
  });

  app.get('/api/sessions', (c) => {
    const limit = Number(c.req.query('limit') ?? 50);
    return c.json(store.storage.listSessions(limit));
  });

  app.get('/api/sessions/:id/observations', (c) => {
    const id = c.req.param('id');
    const limit = Number(c.req.query('limit') ?? 200);
    const rows = store.timeline(id, undefined, limit);
    return c.json(rows.map((r) => ({ ...r, content: expand(r.content) })));
  });

  app.get('/api/search', async (c) => {
    const q = c.req.query('q') ?? '';
    const limit = Number(c.req.query('limit') ?? 10);
    return c.json(await store.search(q, limit));
  });

  app.get('/', (c) => c.html(renderIndex(store.storage.listSessions(50), token)));
  app.get('/sessions/:id', (c) => {
    const id = c.req.param('id');
    const session = store.storage.getSession(id);
    if (!session) return c.notFound();
    const obs = store.timeline(id, undefined, 500);
    return c.html(
      renderSession(
        session,
        obs.map((r) => ({ ...r, content: expand(r.content) })),
        token,
      ),
    );
  });

  return app;
}

function pidFilePath(settings: Settings): string {
  return join(resolveDataDir(settings.dataDir), 'worker.pid');
}

function writePidFile(settings: Settings): void {
  writeFileSync(pidFilePath(settings), String(process.pid));
}

function removePidFile(settings: Settings): void {
  try {
    unlinkSync(pidFilePath(settings));
  } catch {
    // already gone
  }
}

export async function start(): Promise<void> {
  const settings = loadSettings();
  const dbPath = join(resolveDataDir(settings.dataDir), 'data.db');
  const store = new MemoryStore({ dbPath, settings });

  writePidFile(settings);

  let loop: EmbedLoopHandle | undefined;
  const servers: Array<ReturnType<typeof serve>> = [];

  const shutdown = async () => {
    removePidFile(settings);
    if (loop) await loop.stop();
    for (const s of servers) s.close();
    store.close();
  };

  process.on('SIGTERM', () => {
    shutdown().finally(() => process.exit(0));
  });
  process.on('SIGINT', () => {
    shutdown().finally(() => process.exit(0));
  });

  // Build embedder if provider != 'none'. Model load runs in the worker
  // process only — hooks never wait for it.
  let embedder = null;
  try {
    embedder = await createEmbedder(settings, {
      log: (line) => process.stderr.write(`${line}\n`),
    });
  } catch (err) {
    process.stderr.write(
      `[cavemem worker] embedder unavailable: ${err instanceof Error ? err.message : String(err)}\n`,
    );
  }

  if (embedder) {
    loop = startEmbedLoop({
      store,
      embedder,
      settings,
      onIdleExit: () => {
        shutdown().finally(() => process.exit(0));
      },
    });
  } else {
    // Still write a minimal state file so `cavemem status` has something to show.
    writeFileSync(
      stateFilePath(settings),
      `${JSON.stringify(
        {
          provider: settings.embedding.provider,
          model: settings.embedding.model,
          dim: 0,
          embedded: 0,
          total: store.storage.countObservations(),
          lastBatchAt: null,
          lastBatchMs: null,
          lastError: null,
          lastHttpAt: Date.now(),
          startedAt: Date.now(),
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
  }

  const token = getOrCreateToken(settings);
  const app = buildApp(store, { port: settings.workerPort, token, loop });
  servers.push(serve({ fetch: app.fetch, port: settings.workerPort, hostname: '127.0.0.1' }));
  process.stderr.write(
    `[cavemem worker] listening on http://127.0.0.1:${settings.workerPort} (pid ${process.pid})\n`,
  );
}

if (isMainEntry()) {
  start().catch((err) => {
    process.stderr.write(`[cavemem worker] fatal: ${String(err)}\n`);
    process.exit(1);
  });
}

function isMainEntry(): boolean {
  const argv = process.argv[1];
  if (!argv) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(argv)).href;
  } catch {
    return import.meta.url === pathToFileURL(argv).href;
  }
}
