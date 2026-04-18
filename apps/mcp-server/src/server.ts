#!/usr/bin/env node
import { join } from 'node:path';
import { loadSettings, resolveDataDir } from '@cavemem/config';
import { MemoryStore } from '@cavemem/core';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

/**
 * MCP stdio server exposing three tools with progressive disclosure.
 * - search: compact hits (id, score, snippet)
 * - timeline: chronological ids around a point
 * - get_observations: full bodies (expanded by default for the model)
 */
export function buildServer(store: MemoryStore): McpServer {
  const server = new McpServer({
    name: 'cavemem',
    version: '0.1.0',
  });

  server.tool(
    'search',
    'Search memory. Returns compact hits — fetch full bodies via get_observations.',
    { query: z.string().min(1), limit: z.number().int().positive().max(50).optional() },
    async ({ query, limit }) => {
      const hits = await store.search(query, limit);
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
      // Expansion happens exactly once, inside MemoryStore.getObservations,
      // based on the flag we pass. Expanding again here would be wasteful and
      // would drift the text for any non-idempotent lexicon entry.
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

  return server;
}

async function main(): Promise<void> {
  const settings = loadSettings();
  const dbPath = join(resolveDataDir(settings.dataDir), 'data.db');
  const store = new MemoryStore({ dbPath, settings });

  const server = buildServer(store);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    // stderr only — stdout is reserved for the MCP protocol.
    process.stderr.write(`[cavemem mcp] fatal: ${String(err)}\n`);
    process.exit(1);
  });
}
