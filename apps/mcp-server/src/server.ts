#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { type Settings, loadSettings, resolveDataDir } from '@cavemem/config';
import { type Embedder, MemoryStore } from '@cavemem/core';
import { createEmbedder } from '@cavemem/embedding';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

/**
 * MCP stdio server exposing progressive-disclosure tools:
 * - search: compact hits with BM25 + optional semantic re-rank
 * - timeline: chronological IDs around a point
 * - get_observations: full bodies by ID
 * - list_sessions: recent sessions for navigation
 *
 * Embedder is loaded lazily on first search — keeps MCP handshake fast.
 */
export function buildServer(store: MemoryStore, settings: Settings): McpServer {
  const server = new McpServer({
    name: 'cavemem',
    version: '0.1.0',
  });

  // tri-state: undefined = not yet attempted; null = unavailable (provider=none or load failed)
  let embedder: Embedder | null | undefined = undefined;
  const resolveEmbedder = async (): Promise<Embedder | null> => {
    if (embedder !== undefined) return embedder;
    try {
      embedder = await createEmbedder(settings, { log: () => {} });
    } catch (err) {
      process.stderr.write(
        `[cavemem mcp] embedder unavailable: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      embedder = null;
    }
    return embedder;
  };

  server.tool(
    'search',
    'Search memory. Returns compact hits — fetch full bodies via get_observations.',
    { query: z.string().min(1), limit: z.number().int().positive().max(50).optional() },
    async ({ query, limit }) => {
      const e = (await resolveEmbedder()) ?? undefined;
      const hits = await store.search(query, limit, e);
      return {
        content: [{ type: 'text', text: JSON.stringify(hits) }],
      };
    },
  );

  server.tool(
    'timeline',
    'Chronological observation IDs for a session. Use to locate context around a point.',
    {
      session_id: z.string().min(1),
      around_id: z.number().int().positive().optional(),
      limit: z.number().int().positive().max(200).optional(),
    },
    async ({ session_id, around_id, limit }) => {
      const rows = store.timeline(session_id, around_id, limit);
      const compact = rows.map((r) => ({ id: r.id, kind: r.kind, ts: r.ts }));
      return { content: [{ type: 'text', text: JSON.stringify(compact) }] };
    },
  );

  server.tool(
    'get_observations',
    'Fetch full observation bodies by ID. Returns expanded text by default.',
    {
      ids: z.array(z.number().int().positive()).min(1).max(50),
      expand: z.boolean().optional(),
    },
    async ({ ids, expand: expandOpt }) => {
      const rows = store.getObservations(ids, { expand: expandOpt ?? true });
      const payload = rows.map((r) => ({
        id: r.id,
        session_id: r.session_id,
        kind: r.kind,
        ts: r.ts,
        content: r.content,
        metadata: r.metadata,
      }));
      return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
    },
  );

  server.tool(
    'list_sessions',
    'List recent sessions in reverse chronological order. Use to navigate before calling timeline.',
    { limit: z.number().int().positive().max(200).optional() },
    async ({ limit }) => {
      const sessions = store.storage.listSessions(limit ?? 20);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              sessions.map((s) => ({
                id: s.id,
                ide: s.ide,
                cwd: s.cwd,
                started_at: s.started_at,
                ended_at: s.ended_at,
              })),
            ),
          },
        ],
      };
    },
  );

  return server;
}

export async function main(): Promise<void> {
  const settings = loadSettings();
  const dbPath = join(resolveDataDir(settings.dataDir), 'data.db');
  const store = new MemoryStore({ dbPath, settings });

  const server = buildServer(store, settings);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (isMainEntry()) {
  main().catch((err) => {
    process.stderr.write(`[cavemem mcp] fatal: ${String(err)}\n`);
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
