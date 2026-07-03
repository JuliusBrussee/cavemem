import { readFileSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Settings, defaultSettings } from '@cavemem/config';
import { MemoryStore } from '@cavemem/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.js';

const fixture = readFileSync(new URL('./fixtures/ddg-search.html', import.meta.url), 'utf8');

const enabledSettings: Settings = {
  ...defaultSettings,
  enrich: { ...defaultSettings.enrich, enabled: true },
};

let dir: string;
let store: MemoryStore;
let client: Client;

async function connect(settings: Settings, fetchImpl?: typeof fetch): Promise<void> {
  const server = buildServer(store, settings, fetchImpl ? { fetchImpl } : {});
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'test', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
}

function fetchStub(routes: Record<string, () => Response | Promise<Response>>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    for (const [prefix, make] of Object.entries(routes)) {
      if (url.startsWith(prefix)) return make();
    }
    throw new Error(`no route for ${url}`);
  }) as typeof fetch;
}

const page = (html: string) =>
  new Response(html, { status: 200, headers: { 'content-type': 'text/html' } });

const happyFetch = () =>
  fetchStub({
    'https://html.duckduckgo.com/html/': () => page(fixture),
    'https://example.com/guide': () => page('<p>Guide body &amp; details.</p>'),
    'https://plain.example.org/post': () => page('<p>Post body.</p>'),
    'https://docs.example.net/intro': () => page('<p>Intro body.</p>'),
  });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cavemem-mcp-enrich-'));
  store = new MemoryStore({ dbPath: join(dir, 'data.db'), settings: defaultSettings });
});

afterEach(async () => {
  await client.close();
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('enrich tool registration', () => {
  it('is not registered when enrich.enabled is false (default)', async () => {
    await connect(defaultSettings);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).not.toContain('enrich');
  });

  it('is registered when enrich.enabled is true', async () => {
    await connect(enabledSettings, happyFetch());
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain('enrich');
  });
});

describe('enrich tool behavior', () => {
  it('returns extracts and stores observations through MemoryStore', async () => {
    await connect(enabledSettings, happyFetch());
    const res = await client.callTool({
      name: 'enrich',
      arguments: { query: 'caveman compression', note: 'checking docs' },
    });
    expect(res.isError).toBeFalsy();
    const text = (res.content as Array<{ type: string; text: string }>)[0]?.text ?? '{}';
    const body = JSON.parse(text) as {
      query: string;
      results: Array<{ title: string; url: string; extract: string; observation_id: number }>;
      stored_ids: number[];
    };
    expect(body.query).toBe('caveman compression');
    expect(body.results).toHaveLength(3);
    expect(body.results[0]).toMatchObject({
      title: 'Caveman Compression Guide & Reference',
      url: 'https://example.com/guide?ref=ddg',
      extract: 'Guide body & details.',
    });
    expect(body.stored_ids).toEqual(body.results.map((r) => r.observation_id));

    // Stored through MemoryStore: compressed, provenance-tagged, URL intact.
    const rows = store.getObservations(body.stored_ids, { expand: false });
    expect(rows).toHaveLength(3);
    for (const [i, row] of rows.entries()) {
      expect(row.kind).toBe('enrichment');
      expect(row.compressed).toBe(true);
      expect(row.metadata).toMatchObject({
        source: 'web',
        url: body.results[i]?.url,
        query: 'caveman compression',
        note: 'checking docs',
      });
      // URL survives compression byte-for-byte.
      expect(row.content).toContain(body.results[i]?.url ?? '!missing!');
    }

    // All rows hang off one synthetic session with enrich provenance.
    const sessionIds = new Set(rows.map((r) => r.session_id));
    expect(sessionIds.size).toBe(1);
    const session = store.storage.listSessions().find((s) => rows[0]?.session_id === s.id);
    expect(session?.ide).toBe('enrich');
    expect(session?.cwd).toBe(process.cwd());
  });

  it('reuses the same synthetic session across calls', async () => {
    await connect(enabledSettings, happyFetch());
    const call = async () => {
      const res = await client.callTool({ name: 'enrich', arguments: { query: 'q' } });
      const text = (res.content as Array<{ type: string; text: string }>)[0]?.text ?? '{}';
      return JSON.parse(text) as { stored_ids: number[] };
    };
    const first = await call();
    const second = await call();
    const rows = store.getObservations([...first.stored_ids, ...second.stored_ids]);
    expect(new Set(rows.map((r) => r.session_id)).size).toBe(1);
  });

  it('returns an error and stores nothing when the search fails', async () => {
    await connect(
      enabledSettings,
      fetchStub({
        'https://html.duckduckgo.com/html/': () => {
          throw new Error('getaddrinfo ENOTFOUND html.duckduckgo.com');
        },
      }),
    );
    const res = await client.callTool({ name: 'enrich', arguments: { query: 'q' } });
    expect(res.isError).toBe(true);
    const text = (res.content as Array<{ type: string; text: string }>)[0]?.text ?? '';
    expect(text).toMatch(/enrich failed/);
    expect(store.storage.countObservations()).toBe(0);
    expect(store.storage.listSessions()).toHaveLength(0);
  });

  it('returns an error and stores nothing on a non-OK search response', async () => {
    await connect(
      enabledSettings,
      fetchStub({
        'https://html.duckduckgo.com/html/': () => new Response('blocked', { status: 403 }),
      }),
    );
    const res = await client.callTool({ name: 'enrich', arguments: { query: 'q' } });
    expect(res.isError).toBe(true);
    expect(store.storage.countObservations()).toBe(0);
  });

  it('returns an error when every result page fails, storing nothing', async () => {
    await connect(
      enabledSettings,
      fetchStub({
        'https://html.duckduckgo.com/html/': () => page(fixture),
        'https:': () => new Response('down', { status: 502 }),
      }),
    );
    const res = await client.callTool({ name: 'enrich', arguments: { query: 'q' } });
    expect(res.isError).toBe(true);
    expect(store.storage.countObservations()).toBe(0);
  });

  it('rejects an empty query via input validation', async () => {
    await connect(enabledSettings, happyFetch());
    const res = await client.callTool({ name: 'enrich', arguments: { query: '' } });
    expect(res.isError).toBe(true);
    expect(store.storage.countObservations()).toBe(0);
  });
});
