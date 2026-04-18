import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { claudeCode } from '../src/claude-code.js';
import { cursor } from '../src/cursor.js';
import { deepMerge } from '../src/fs-utils.js';
import { getInstaller, installers } from '../src/registry.js';
import type { InstallContext } from '../src/types.js';

let home: string;
let originalHome: string | undefined;
let ctx: InstallContext;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'cavemem-ins-'));
  originalHome = process.env.HOME;
  process.env.HOME = home;
  ctx = {
    ideConfigDir: home,
    cliPath: '/fake/bin/cavemem',
    dataDir: join(home, '.cavemem'),
  };
});

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  rmSync(home, { recursive: true, force: true });
});

describe('registry', () => {
  it('exposes all expected installers', () => {
    expect(Object.keys(installers).sort()).toEqual(
      ['claude-code', 'codex', 'cursor', 'gemini-cli', 'opencode'].sort(),
    );
  });
  it('getInstaller throws on unknown id', () => {
    expect(() => getInstaller('nope')).toThrow(/Unknown IDE/);
  });
});

describe('deepMerge', () => {
  it('recursively merges nested objects', () => {
    const a = { a: { b: 1, c: 2 }, d: 3 };
    const b = { a: { c: 20, e: 5 }, f: 6 };
    expect(deepMerge(a, b as Partial<typeof a>)).toEqual({
      a: { b: 1, c: 20, e: 5 },
      d: 3,
      f: 6,
    });
  });
  it('replaces arrays instead of concatenating', () => {
    expect(deepMerge({ xs: [1, 2] }, { xs: [3] } as Partial<{ xs: number[] }>)).toEqual({
      xs: [3],
    });
  });
});

describe('claude-code installer', () => {
  it('writes hooks + mcpServer for a fresh install and is idempotent', async () => {
    await claudeCode.install(ctx);
    const settingsPath = join(home, '.claude', 'settings.json');
    expect(existsSync(settingsPath)).toBe(true);
    const first = JSON.parse(readFileSync(settingsPath, 'utf8')) as {
      hooks: Record<
        string,
        Array<{ hooks: Array<{ type: string; command: string }> }>
      >;
      mcpServers: Record<string, { command: string; args?: string[] }>;
    };
    expect(Object.keys(first.hooks).sort()).toEqual(
      ['PostToolUse', 'SessionEnd', 'SessionStart', 'Stop', 'UserPromptSubmit'].sort(),
    );
    expect(first.hooks.SessionStart?.[0]?.hooks?.[0]?.command).toBe(
      `${ctx.cliPath} hook run session-start`,
    );
    expect(first.mcpServers.cavemem).toEqual({ command: ctx.cliPath, args: ['mcp'] });

    await claudeCode.install(ctx); // run twice
    const second = JSON.parse(readFileSync(settingsPath, 'utf8')) as typeof first;
    expect(Object.keys(second.hooks).sort()).toEqual(Object.keys(first.hooks).sort());
    // No duplicate cavemem entries.
    expect(Object.keys(second.mcpServers)).toEqual(['cavemem']);
  });

  it('preserves unrelated user settings on install + uninstall', async () => {
    const settingsPath = join(home, '.claude', 'settings.json');
    mkdirSync(join(home, '.claude'), { recursive: true });
    writeFileSync(
      settingsPath,
      JSON.stringify({
        theme: 'dark',
        mcpServers: { other: { command: '/other/bin' } },
        hooks: { CustomEvent: [{ hooks: [{ type: 'command', command: 'noop' }] }] },
      }),
    );

    await claudeCode.install(ctx);
    const installed = JSON.parse(readFileSync(settingsPath, 'utf8')) as {
      theme: string;
      hooks: Record<string, unknown>;
      mcpServers: Record<string, unknown>;
    };
    expect(installed.theme).toBe('dark');
    expect(installed.mcpServers.other).toEqual({ command: '/other/bin' });
    expect(installed.hooks.CustomEvent).toBeDefined();

    await claudeCode.uninstall(ctx);
    const after = JSON.parse(readFileSync(settingsPath, 'utf8')) as typeof installed;
    expect(after.theme).toBe('dark');
    expect(after.mcpServers.other).toEqual({ command: '/other/bin' });
    expect(after.mcpServers.cavemem).toBeUndefined();
    expect(after.hooks.SessionStart).toBeUndefined();
    expect(after.hooks.CustomEvent).toBeDefined();
  });

  it('detect returns true only when ~/.claude exists', async () => {
    expect(await claudeCode.detect(ctx)).toBe(false);
    mkdirSync(join(home, '.claude'));
    expect(await claudeCode.detect(ctx)).toBe(true);
  });
});

describe('cursor installer', () => {
  it('writes a cursor MCP config and removes it cleanly', async () => {
    await cursor.install(ctx);
    const p = join(home, '.cursor', 'mcp.json');
    expect(existsSync(p)).toBe(true);
    const cfg = JSON.parse(readFileSync(p, 'utf8')) as {
      mcpServers: Record<string, { command: string; args?: string[] }>;
    };
    expect(cfg.mcpServers.cavemem).toEqual({ command: ctx.cliPath, args: ['mcp'] });

    await cursor.uninstall(ctx);
    const after = JSON.parse(readFileSync(p, 'utf8')) as typeof cfg;
    expect(after.mcpServers.cavemem).toBeUndefined();
  });
});
