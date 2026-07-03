import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Settings, defaultSettings } from '@cavemem/config';
import { MemoryStore } from '@cavemem/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runHook } from '../src/index.js';

let dir: string;

function makeStore(overrides: Partial<Settings> = {}): MemoryStore {
  const settings: Settings = {
    ...defaultSettings,
    ...overrides,
    privacy: { ...defaultSettings.privacy, ...overrides.privacy },
    capture: { ...defaultSettings.capture, ...overrides.capture },
  };
  return new MemoryStore({ dbPath: join(dir, `${Math.random()}.db`), settings });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cavemem-hooks-privacy-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('postToolUse — excludePatterns (#48)', () => {
  it('skips capture entirely when tool_input.file_path matches an excludePattern', async () => {
    const store = makeStore({ privacy: { excludePatterns: ['**/.env'], redactSecrets: true } });
    await runHook('session-start', { session_id: 's1', ide: 'claude-code' }, { store });
    const r = await runHook(
      'post-tool-use',
      {
        session_id: 's1',
        tool_name: 'Read',
        tool_input: { file_path: '/repo/.env' },
        tool_response: { content: 'SECRET=1' },
      },
      { store },
    );
    expect(r.ok).toBe(true);
    expect(store.timeline('s1')).toHaveLength(0);
    store.close();
  });

  it('skips capture when a nested secrets/** path is embedded in tool output', async () => {
    const store = makeStore({
      privacy: { excludePatterns: ['**/secrets/**'], redactSecrets: true },
    });
    await runHook('session-start', { session_id: 's2', ide: 'claude-code' }, { store });
    const r = await runHook(
      'post-tool-use',
      {
        session_id: 's2',
        tool_name: 'Bash',
        tool_input: { command: 'cat repo/secrets/api.txt' },
        tool_response: 'key=abc123',
      },
      { store },
    );
    expect(r.ok).toBe(true);
    expect(store.timeline('s2')).toHaveLength(0);
    store.close();
  });

  it('still records observations for paths that do not match any excludePattern', async () => {
    const store = makeStore({ privacy: { excludePatterns: ['**/.env'], redactSecrets: true } });
    await runHook('session-start', { session_id: 's3', ide: 'claude-code' }, { store });
    const r = await runHook(
      'post-tool-use',
      {
        session_id: 's3',
        tool_name: 'Read',
        tool_input: { file_path: '/repo/src/index.ts' },
        tool_response: { content: 'export const x = 1;' },
      },
      { store },
    );
    expect(r.ok).toBe(true);
    expect(store.timeline('s3')).toHaveLength(1);
    store.close();
  });
});

describe('postToolUse — capture allow/deny list (#50)', () => {
  it('excludeTools blocks a matching tool', async () => {
    const store = makeStore({ capture: { excludeTools: ['Bash'], includeTools: [] } });
    await runHook('session-start', { session_id: 's4', ide: 'claude-code' }, { store });
    const r = await runHook(
      'post-tool-use',
      { session_id: 's4', tool_name: 'Bash', tool_input: { command: 'ls' }, tool_response: 'ok' },
      { store },
    );
    expect(r.ok).toBe(true);
    expect(store.timeline('s4')).toHaveLength(0);
    store.close();
  });

  it('excludeTools supports a tool-name glob', async () => {
    const store = makeStore({ capture: { excludeTools: ['mcp__broker__*'], includeTools: [] } });
    await runHook('session-start', { session_id: 's5', ide: 'claude-code' }, { store });
    const r = await runHook(
      'post-tool-use',
      { session_id: 's5', tool_name: 'mcp__broker__send', tool_input: {}, tool_response: 'ok' },
      { store },
    );
    expect(r.ok).toBe(true);
    expect(store.timeline('s5')).toHaveLength(0);
    store.close();
  });

  it('includeTools allowlist blocks tools not listed', async () => {
    const store = makeStore({ capture: { excludeTools: [], includeTools: ['Edit'] } });
    await runHook('session-start', { session_id: 's6', ide: 'claude-code' }, { store });
    const blocked = await runHook(
      'post-tool-use',
      { session_id: 's6', tool_name: 'Bash', tool_input: { command: 'ls' }, tool_response: 'ok' },
      { store },
    );
    expect(blocked.ok).toBe(true);
    expect(store.timeline('s6')).toHaveLength(0);

    const allowed = await runHook(
      'post-tool-use',
      {
        session_id: 's6',
        tool_name: 'Edit',
        tool_input: { file_path: '/repo/a.ts' },
        tool_response: { success: true },
      },
      { store },
    );
    expect(allowed.ok).toBe(true);
    expect(store.timeline('s6')).toHaveLength(1);
    store.close();
  });

  it('excludeTools wins over includeTools when both match the same tool', async () => {
    const store = makeStore({
      capture: { excludeTools: ['Edit'], includeTools: ['Edit', 'Bash'] },
    });
    await runHook('session-start', { session_id: 's7', ide: 'claude-code' }, { store });
    const r = await runHook(
      'post-tool-use',
      {
        session_id: 's7',
        tool_name: 'Edit',
        tool_input: { file_path: '/repo/a.ts' },
        tool_response: { success: true },
      },
      { store },
    );
    expect(r.ok).toBe(true);
    expect(store.timeline('s7')).toHaveLength(0);
    store.close();
  });
});
