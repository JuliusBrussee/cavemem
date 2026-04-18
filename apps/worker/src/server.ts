#!/usr/bin/env node
import { join } from 'node:path';
import { expand } from '@cavemem/compress';
import { loadSettings, resolveDataDir } from '@cavemem/config';
import { MemoryStore } from '@cavemem/core';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { renderIndex, renderSession } from './viewer.js';

export async function start(): Promise<void> {
  const settings = loadSettings();
  const dbPath = join(resolveDataDir(settings.dataDir), 'data.db');
  const store = new MemoryStore({ dbPath, settings });
  const app = new Hono();

  app.get('/healthz', (c) => c.json({ ok: true }));

  app.get('/api/sessions', (c) => {
    const limit = Number(c.req.query('limit') ?? 50);
    return c.json(store.storage.listSessions(limit));
  });

  app.get('/api/sessions/:id/observations', (c) => {
    const id = c.req.param('id');
    const limit = Number(c.req.query('limit') ?? 200);
    const rows = store.timeline(id, undefined, limit);
    // Serve human-readable text to the viewer.
    return c.json(rows.map((r) => ({ ...r, content: expand(r.content) })));
  });

  app.get('/api/search', async (c) => {
    const q = c.req.query('q') ?? '';
    const limit = Number(c.req.query('limit') ?? 10);
    return c.json(await store.search(q, limit));
  });

  app.get('/', (c) => c.html(renderIndex(store.storage.listSessions(50))));
  app.get('/sessions/:id', (c) => {
    const id = c.req.param('id');
    const session = store.storage.getSession(id);
    if (!session) return c.notFound();
    const obs = store.timeline(id, undefined, 500);
    return c.html(
      renderSession(
        session,
        obs.map((r) => ({ ...r, content: expand(r.content) })),
      ),
    );
  });

  serve({ fetch: app.fetch, port: settings.workerPort, hostname: '127.0.0.1' });
  process.stderr.write(`[cavemem worker] listening on http://127.0.0.1:${settings.workerPort}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  start().catch((err) => {
    process.stderr.write(`[cavemem worker] fatal: ${String(err)}\n`);
    process.exit(1);
  });
}
