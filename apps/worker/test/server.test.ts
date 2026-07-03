import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultSettings } from '@cavemem/config';
import { MemoryStore } from '@cavemem/core';
import type { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getOrCreateToken } from '../src/security.js';
import { buildApp } from '../src/server.js';

const PORT = defaultSettings.workerPort;
const HOST = `127.0.0.1:${PORT}`;
const TOKEN = 'test-token';

let dir: string;
let store: MemoryStore;
let app: Hono;

function seed(): { sessionId: string; a: number; b: number } {
  store.startSession({ id: 's1', ide: 'claude-code', cwd: '/tmp' });
  const a = store.addObservation({
    session_id: 's1',
    kind: 'note',
    content: 'The db config lives at /etc/caveman.conf.',
  });
  const b = store.addObservation({
    session_id: 's1',
    kind: 'note',
    content: 'Please run `pnpm test` now.',
  });
  return { sessionId: 's1', a, b };
}

/** Every real request carries a valid Host header; tests opt out per-case to probe rejection. */
async function req(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has('host')) headers.set('host', HOST);
  return app.request(path, { ...init, headers });
}

/** Same as `req`, plus a valid bearer token for /api/* routes. */
async function apiReq(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${TOKEN}`);
  return req(path, { ...init, headers });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cavemem-worker-'));
  store = new MemoryStore({ dbPath: join(dir, 'data.db'), settings: defaultSettings });
  app = buildApp(store, { port: PORT, token: TOKEN });
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('worker HTTP', () => {
  it('GET /healthz returns ok', async () => {
    const res = await req('/healthz');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('GET /api/sessions returns a session list', async () => {
    seed();
    const res = await apiReq('/api/sessions');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string }>;
    expect(body.map((s) => s.id)).toContain('s1');
  });

  it('GET /api/sessions/:id/observations returns expanded text', async () => {
    seed();
    const res = await apiReq('/api/sessions/s1/observations');
    expect(res.status).toBe(200);
    const rows = (await res.json()) as Array<{ content: string }>;
    expect(rows.length).toBeGreaterThan(0);
    // Database abbreviation should be expanded for the viewer.
    expect(rows.some((r) => /database/.test(r.content))).toBe(true);
    // Tech tokens preserved.
    expect(rows.some((r) => r.content.includes('/etc/caveman.conf'))).toBe(true);
  });

  it('GET /api/search returns matching observations', async () => {
    seed();
    const res = await apiReq('/api/search?q=config');
    expect(res.status).toBe(200);
    const hits = (await res.json()) as Array<{ id: number; snippet: string }>;
    expect(hits.length).toBeGreaterThan(0);
  });

  it('GET / renders the session index HTML', async () => {
    seed();
    const res = await req('/');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type') ?? '').toMatch(/text\/html/);
    const body = await res.text();
    expect(body).toContain('s1');
  });

  it('GET /sessions/:id renders observation HTML', async () => {
    seed();
    const res = await req('/sessions/s1');
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('/etc/caveman.conf');
  });

  it('GET /sessions/:unknown returns 404', async () => {
    const res = await req('/sessions/does-not-exist');
    expect(res.status).toBe(404);
  });

  describe('Host allowlist', () => {
    it('rejects a mismatched Host header (DNS rebinding)', async () => {
      const res = await req('/healthz', { headers: { host: 'evil.example:37777' } });
      expect(res.status).toBe(403);
    });

    it('rejects a missing Host header', async () => {
      const res = await app.request('/healthz');
      expect(res.status).toBe(403);
    });

    it('accepts localhost:<port> as well as 127.0.0.1:<port>', async () => {
      const res = await req('/healthz', { headers: { host: `localhost:${PORT}` } });
      expect(res.status).toBe(200);
    });
  });

  describe('Origin check', () => {
    it('rejects a foreign Origin header', async () => {
      const res = await req('/healthz', { headers: { origin: 'http://evil.example' } });
      expect(res.status).toBe(403);
    });

    it('allows requests with no Origin header', async () => {
      const res = await req('/healthz');
      expect(res.status).toBe(200);
    });

    it('allows a matching Origin header', async () => {
      const res = await req('/healthz', { headers: { origin: `http://${HOST}` } });
      expect(res.status).toBe(200);
    });

    it('never adds CORS headers', async () => {
      const res = await req('/healthz', { headers: { origin: `http://${HOST}` } });
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    });
  });

  describe('Bearer token on /api/*', () => {
    it('rejects a missing token', async () => {
      const res = await req('/api/sessions');
      expect(res.status).toBe(401);
    });

    it('rejects a wrong token', async () => {
      const res = await req('/api/sessions', { headers: { authorization: 'Bearer wrong' } });
      expect(res.status).toBe(401);
    });

    it('accepts the correct token via Authorization: Bearer', async () => {
      const res = await apiReq('/api/sessions');
      expect(res.status).toBe(200);
    });

    it('accepts the correct token via X-Cavemem-Token', async () => {
      const res = await req('/api/sessions', { headers: { 'x-cavemem-token': TOKEN } });
      expect(res.status).toBe(200);
    });

    it('does not require a token on non-API HTML routes', async () => {
      const res = await req('/');
      expect(res.status).toBe(200);
    });
  });

  describe('viewer HTML token injection', () => {
    it('embeds the token as window.__CAVEMEM_TOKEN__ on the index page', async () => {
      const res = await req('/');
      const body = await res.text();
      expect(body).toContain(`window.__CAVEMEM_TOKEN__=${JSON.stringify(TOKEN)}`);
    });

    it('embeds the token on a session page', async () => {
      seed();
      const res = await req('/sessions/s1');
      const body = await res.text();
      expect(body).toContain(`window.__CAVEMEM_TOKEN__=${JSON.stringify(TOKEN)}`);
    });
  });
});

describe('worker token file', () => {
  let tokenDir: string;

  beforeEach(() => {
    tokenDir = mkdtempSync(join(tmpdir(), 'cavemem-token-'));
  });

  afterEach(() => {
    rmSync(tokenDir, { recursive: true, force: true });
  });

  it('creates a token file with mode 0600 on first call', () => {
    const settings = { ...defaultSettings, dataDir: tokenDir };
    const token = getOrCreateToken(settings);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    const tokenPath = join(tokenDir, 'worker-token');
    expect(existsSync(tokenPath)).toBe(true);
    expect(statSync(tokenPath).mode & 0o777).toBe(0o600);
  });

  it('reuses the existing token on subsequent calls', () => {
    const settings = { ...defaultSettings, dataDir: tokenDir };
    const first = getOrCreateToken(settings);
    const second = getOrCreateToken(settings);
    expect(second).toBe(first);
  });
});
