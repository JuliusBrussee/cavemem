import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultSettings } from '@cavemem/config';
import { MemoryStore } from '@cavemem/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runHook } from '../src/index.js';

let dir: string;
let store: MemoryStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cavemem-hooks-'));
  store = new MemoryStore({ dbPath: join(dir, 'data.db'), settings: defaultSettings });
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('runHook', () => {
  it('session-start creates a session and returns a (possibly empty) context', async () => {
    const r = await runHook(
      'session-start',
      { session_id: 'sess-a', ide: 'claude-code', cwd: '/tmp' },
      { store },
    );
    expect(r.ok).toBe(true);
    expect(store.storage.getSession('sess-a')?.ide).toBe('claude-code');
    expect(typeof r.context).toBe('string');
  });

  it('user-prompt-submit records a compressed observation', async () => {
    await runHook(
      'session-start',
      { session_id: 'sess-b', ide: 'claude-code' },
      { store },
    );
    const r = await runHook(
      'user-prompt-submit',
      {
        session_id: 'sess-b',
        ide: 'claude-code',
        prompt: 'Please basically just update the /etc/hosts file.',
      },
      { store },
    );
    expect(r.ok).toBe(true);
    const tl = store.timeline('sess-b');
    expect(tl).toHaveLength(1);
    expect(tl[0]?.kind).toBe('user_prompt');
    expect(tl[0]?.compressed).toBe(true);
    // Path is preserved byte-for-byte even when neighbouring prose is stripped.
    expect(tl[0]?.content).toContain('/etc/hosts');
    expect(tl[0]?.content).not.toMatch(/basically/i);
  });

  it('post-tool-use records a tool_use observation with metadata', async () => {
    await runHook(
      'session-start',
      { session_id: 'sess-c', ide: 'claude-code' },
      { store },
    );
    const r = await runHook(
      'post-tool-use',
      {
        session_id: 'sess-c',
        ide: 'claude-code',
        tool: 'Bash',
        tool_input: { command: 'ls' },
        tool_output: 'file.txt',
      },
      { store },
    );
    expect(r.ok).toBe(true);
    const tl = store.timeline('sess-c');
    expect(tl).toHaveLength(1);
    expect(tl[0]?.kind).toBe('tool_use');
    expect(tl[0]?.metadata).toEqual({ tool: 'Bash' });
  });

  it('stop stores a turn summary; session-end rolls up turns and closes the session', async () => {
    await runHook(
      'session-start',
      { session_id: 'sess-d', ide: 'claude-code' },
      { store },
    );
    await runHook(
      'stop',
      { session_id: 'sess-d', ide: 'claude-code', turn_summary: 'fixed the auth bug' },
      { store },
    );
    await runHook(
      'stop',
      { session_id: 'sess-d', ide: 'claude-code', turn_summary: 'updated tests' },
      { store },
    );
    const turns = store.storage.listSummaries('sess-d').filter((s) => s.scope === 'turn');
    expect(turns).toHaveLength(2);

    await runHook(
      'session-end',
      { session_id: 'sess-d', ide: 'claude-code' },
      { store },
    );
    const sessions = store.storage.listSummaries('sess-d').filter((s) => s.scope === 'session');
    expect(sessions).toHaveLength(1);
    expect(store.storage.getSession('sess-d')?.ended_at).not.toBeNull();
  });

  it('returns ok=false with an error message when a handler throws', async () => {
    // Re-using a session id will trigger a PK conflict on session-start.
    await runHook(
      'session-start',
      { session_id: 'dup', ide: 'claude-code' },
      { store },
    );
    const r = await runHook(
      'session-start',
      { session_id: 'dup', ide: 'claude-code' },
      { store },
    );
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
  });

  it('hot-path hooks stay under a generous 150ms budget on a warm runtime', async () => {
    await runHook(
      'session-start',
      { session_id: 'sess-perf', ide: 'claude-code' },
      { store },
    );
    // Warm up JIT / prepared-statement cache.
    for (let i = 0; i < 5; i++) {
      await runHook(
        'post-tool-use',
        {
          session_id: 'sess-perf',
          ide: 'claude-code',
          tool: 'Bash',
          tool_input: { command: 'noop' },
          tool_output: 'ok',
        },
        { store },
      );
    }
    const samples: number[] = [];
    for (let i = 0; i < 20; i++) {
      const t0 = performance.now();
      await runHook(
        'post-tool-use',
        {
          session_id: 'sess-perf',
          ide: 'claude-code',
          tool: 'Bash',
          tool_input: { command: 'noop' },
          tool_output: 'ok',
        },
        { store },
      );
      samples.push(performance.now() - t0);
    }
    samples.sort((a, b) => a - b);
    const p95 = samples[Math.floor(samples.length * 0.95)] ?? 0;
    expect(p95).toBeLessThan(150);
  });
});
