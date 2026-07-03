import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { claudeCode } from '../src/claude-code.js';
import { codex } from '../src/codex.js';
import { cursor } from '../src/cursor.js';
import { deepMerge } from '../src/fs-utils.js';
import { openCode } from '../src/opencode.js';
import { getInstaller, installers } from '../src/registry.js';
import type { InstallContext } from '../src/types.js';

let home: string;
let originalHome: string | undefined;
let originalUserProfile: string | undefined;
let ctx: InstallContext;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'cavemem-ins-'));
  originalHome = process.env.HOME;
  originalUserProfile = process.env.USERPROFILE;
  process.env.HOME = home;
  // node:os.homedir() reads USERPROFILE on Windows; keep them in sync so the
  // installer's homedir() call lines up with the test's `home` regardless of
  // platform.
  process.env.USERPROFILE = home;
  ctx = {
    ideConfigDir: home,
    cliPath: '/fake/bin/cavemem.js',
    nodeBin: '/fake/bin/node',
    dataDir: join(home, '.cavemem'),
  };
});

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = originalUserProfile;
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
    const a: Record<string, unknown> = { a: { b: 1, c: 2 }, d: 3 };
    const b: Record<string, unknown> = { a: { c: 20, e: 5 }, f: 6 };
    expect(deepMerge(a, b)).toEqual({
      a: { b: 1, c: 20, e: 5 },
      d: 3,
      f: 6,
    });
  });
  it('replaces arrays instead of concatenating', () => {
    const base: Record<string, unknown> = { xs: [1, 2] };
    const add: Record<string, unknown> = { xs: [3] };
    expect(deepMerge(base, add)).toEqual({ xs: [3] });
  });
});

describe('claude-code installer', () => {
  const settingsPath = () => join(home, '.claude', 'settings.json');
  const mcpJsonPath = () => join(home, '.claude.json');

  it('writes hooks to ~/.claude/settings.json and mcpServers to ~/.claude.json', async () => {
    await claudeCode.install(ctx);
    expect(existsSync(settingsPath())).toBe(true);
    expect(existsSync(mcpJsonPath())).toBe(true);

    const settings = JSON.parse(readFileSync(settingsPath(), 'utf8')) as {
      hooks: Record<string, Array<{ hooks: Array<{ type: string; command: string }> }>>;
      mcpServers?: Record<string, unknown>;
    };
    const claudeJson = JSON.parse(readFileSync(mcpJsonPath(), 'utf8')) as {
      mcpServers: Record<string, { command: string; args?: string[] }>;
    };

    expect(Object.keys(settings.hooks).sort()).toEqual(
      ['PostToolUse', 'SessionEnd', 'SessionStart', 'Stop', 'UserPromptSubmit'].sort(),
    );
    expect(settings.hooks.SessionStart?.[0]?.hooks?.[0]?.command).toBe(
      `${ctx.nodeBin} ${ctx.cliPath} hook run session-start --ide claude-code`,
    );
    // settings.json must NOT carry mcpServers.cavemem any more.
    expect(settings.mcpServers?.cavemem).toBeUndefined();

    expect(claudeJson.mcpServers.cavemem).toEqual({
      command: ctx.nodeBin,
      args: [ctx.cliPath, 'mcp'],
    });
  });

  it('is idempotent: re-running install does not duplicate hooks or MCP entries', async () => {
    await claudeCode.install(ctx);
    await claudeCode.install(ctx);
    const settings = JSON.parse(readFileSync(settingsPath(), 'utf8')) as {
      hooks: Record<string, Array<unknown>>;
    };
    const claudeJson = JSON.parse(readFileSync(mcpJsonPath(), 'utf8')) as {
      mcpServers: Record<string, unknown>;
    };
    for (const name of ['SessionStart', 'UserPromptSubmit', 'PostToolUse', 'Stop', 'SessionEnd']) {
      expect(settings.hooks[name]?.length).toBe(1);
    }
    expect(Object.keys(claudeJson.mcpServers)).toEqual(['cavemem']);
  });

  it('preserves pre-existing hook entries on cavemem-managed event names', async () => {
    mkdirSync(join(home, '.claude'), { recursive: true });
    writeFileSync(
      settingsPath(),
      JSON.stringify({
        hooks: {
          SessionStart: [
            { hooks: [{ type: 'command', command: 'echo pre-existing-1' }] },
            { hooks: [{ type: 'command', command: 'echo pre-existing-2' }] },
          ],
          PreToolUse: [
            { matcher: 'Edit', hooks: [{ type: 'command', command: 'echo pre-existing-3' }] },
          ],
          CustomEvent: [{ hooks: [{ type: 'command', command: 'noop' }] }],
        },
      }),
    );

    const messages = await claudeCode.install(ctx);
    const settings = JSON.parse(readFileSync(settingsPath(), 'utf8')) as {
      hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
    };

    // Pre-existing SessionStart entries survive, cavemem appended at the end.
    expect(settings.hooks.SessionStart?.length).toBe(3);
    expect(settings.hooks.SessionStart?.[0]?.hooks?.[0]?.command).toBe('echo pre-existing-1');
    expect(settings.hooks.SessionStart?.[1]?.hooks?.[0]?.command).toBe('echo pre-existing-2');
    expect(settings.hooks.SessionStart?.[2]?.hooks?.[0]?.command).toContain(
      'hook run session-start',
    );

    // PreToolUse is not cavemem-managed; left untouched.
    expect(settings.hooks.PreToolUse?.length).toBe(1);
    expect(settings.hooks.PreToolUse?.[0]?.hooks?.[0]?.command).toBe('echo pre-existing-3');

    // CustomEvent untouched.
    expect(settings.hooks.CustomEvent?.length).toBe(1);

    // Backup sidecar written.
    const backups = readdirSync(join(home, '.claude')).filter((f) =>
      f.startsWith('settings.json.pre-cavemem-'),
    );
    expect(backups.length).toBe(1);
    expect(messages.some((m) => m.includes('backed up existing hooks'))).toBe(true);
  });

  it('does not write a backup on a fresh install with no prior hooks', async () => {
    const messages = await claudeCode.install(ctx);
    const backups = readdirSync(join(home, '.claude')).filter((f) =>
      f.startsWith('settings.json.pre-cavemem-'),
    );
    expect(backups.length).toBe(0);
    expect(messages.some((m) => m.includes('backed up'))).toBe(false);
  });

  it('preserves unrelated keys in ~/.claude.json (project MCP entries, etc.)', async () => {
    writeFileSync(
      mcpJsonPath(),
      JSON.stringify({
        userID: 'abc',
        projects: { '/some/path': { mcpServers: { other: { command: '/x' } } } },
        mcpServers: { existing: { command: '/other/bin' } },
      }),
    );
    await claudeCode.install(ctx);
    const claudeJson = JSON.parse(readFileSync(mcpJsonPath(), 'utf8')) as {
      userID: string;
      projects: Record<string, unknown>;
      mcpServers: Record<string, unknown>;
    };
    expect(claudeJson.userID).toBe('abc');
    expect(claudeJson.projects).toBeDefined();
    expect(claudeJson.mcpServers.existing).toEqual({ command: '/other/bin' });
    expect(claudeJson.mcpServers.cavemem).toBeDefined();
  });

  it('migrates legacy mcpServers.cavemem out of settings.json on install', async () => {
    mkdirSync(join(home, '.claude'), { recursive: true });
    writeFileSync(
      settingsPath(),
      JSON.stringify({
        mcpServers: {
          cavemem: { command: 'old', args: [] },
          keep: { command: '/keep' },
        },
        theme: 'dark',
      }),
    );
    await claudeCode.install(ctx);
    const settings = JSON.parse(readFileSync(settingsPath(), 'utf8')) as {
      theme: string;
      mcpServers?: Record<string, unknown>;
    };
    expect(settings.theme).toBe('dark');
    expect(settings.mcpServers?.cavemem).toBeUndefined();
    // Other mcpServers entries in settings.json (if any user put them there)
    // are left alone — they're inert since Claude Code reads from ~/.claude.json,
    // but removing them would be a destructive surprise.
    expect(settings.mcpServers?.keep).toEqual({ command: '/keep' });
  });

  it('uninstall removes only cavemem entries, leaves everything else', async () => {
    mkdirSync(join(home, '.claude'), { recursive: true });
    writeFileSync(
      settingsPath(),
      JSON.stringify({
        theme: 'dark',
        hooks: {
          SessionStart: [{ hooks: [{ type: 'command', command: 'echo other' }] }],
          CustomEvent: [{ hooks: [{ type: 'command', command: 'noop' }] }],
        },
      }),
    );
    writeFileSync(
      mcpJsonPath(),
      JSON.stringify({
        userID: 'abc',
        mcpServers: { other: { command: '/other/bin' } },
      }),
    );

    await claudeCode.install(ctx);
    await claudeCode.uninstall(ctx);

    const settings = JSON.parse(readFileSync(settingsPath(), 'utf8')) as {
      theme: string;
      hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
    };
    expect(settings.theme).toBe('dark');
    expect(settings.hooks.SessionStart?.length).toBe(1);
    expect(settings.hooks.SessionStart?.[0]?.hooks?.[0]?.command).toBe('echo other');
    expect(settings.hooks.UserPromptSubmit).toBeUndefined();
    expect(settings.hooks.CustomEvent?.length).toBe(1);

    const claudeJson = JSON.parse(readFileSync(mcpJsonPath(), 'utf8')) as {
      userID: string;
      mcpServers: Record<string, unknown>;
    };
    expect(claudeJson.userID).toBe('abc');
    expect(claudeJson.mcpServers.other).toEqual({ command: '/other/bin' });
    expect(claudeJson.mcpServers.cavemem).toBeUndefined();
  });

  it('quotes paths with spaces in hook command strings (Windows)', async () => {
    const winCtx: InstallContext = {
      ideConfigDir: home,
      cliPath: 'C:\\Users\\Some User\\AppData\\Roaming\\npm\\node_modules\\cavemem\\dist\\index.js',
      nodeBin: 'C:\\Program Files\\nodejs\\node.exe',
      dataDir: join(home, '.cavemem'),
    };
    await claudeCode.install(winCtx);
    const settings = JSON.parse(readFileSync(settingsPath(), 'utf8')) as {
      hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
    };
    const claudeJson = JSON.parse(readFileSync(mcpJsonPath(), 'utf8')) as {
      mcpServers: Record<string, { command: string; args: string[] }>;
    };
    const cmd = settings.hooks.SessionStart?.[0]?.hooks?.[0]?.command ?? '';
    expect(cmd).toBe(
      `"${winCtx.nodeBin}" "${winCtx.cliPath}" hook run session-start --ide claude-code`,
    );
    // MCP entry is a structured shape, so no quoting needed there — Claude
    // spawns command + args directly.
    expect(claudeJson.mcpServers.cavemem).toEqual({
      command: winCtx.nodeBin,
      args: [winCtx.cliPath, 'mcp'],
    });
  });

  it('quotes Windows paths even when they contain no spaces (MSYS-bash strip)', async () => {
    // Regression for #41: shellQuote previously whitelisted backslash, so a
    // default Windows install path with no spaces was written unquoted into
    // the hook `command`. MSYS-bash (the shell Claude Code uses on Windows
    // from the desktop app) then stripped the backslashes, turning the path
    // into garbage and the hook into MODULE_NOT_FOUND.
    const winCtx: InstallContext = {
      ideConfigDir: home,
      cliPath: 'C:\\Users\\User\\AppData\\Roaming\\npm\\node_modules\\cavemem\\dist\\index.js',
      nodeBin: 'C:\\nodejs\\node.exe',
      dataDir: join(home, '.cavemem'),
    };
    await claudeCode.install(winCtx);
    const settings = JSON.parse(readFileSync(settingsPath(), 'utf8')) as {
      hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
    };
    const cmd = settings.hooks.SessionStart?.[0]?.hooks?.[0]?.command ?? '';
    expect(cmd).toBe(
      `"${winCtx.nodeBin}" "${winCtx.cliPath}" hook run session-start --ide claude-code`,
    );
  });

  it('detect returns true only when ~/.claude exists', async () => {
    expect(await claudeCode.detect(ctx)).toBe(false);
    mkdirSync(join(home, '.claude'));
    expect(await claudeCode.detect(ctx)).toBe(true);
  });
});

describe('codex installer', () => {
  const cfg = () => join(home, '.codex', 'config.toml');
  const hooksJson = () => join(home, '.codex', 'hooks.json');

  it('writes config.toml with features + mcp_servers, plus hooks.json', async () => {
    await codex.install(ctx);
    expect(existsSync(cfg())).toBe(true);
    expect(existsSync(hooksJson())).toBe(true);

    const parsed = parseToml(readFileSync(cfg(), 'utf8')) as {
      features: { codex_hooks: boolean };
      mcp_servers: { cavemem: { command: string; args: string[] } };
    };
    expect(parsed.features.codex_hooks).toBe(true);
    expect(parsed.mcp_servers.cavemem.command).toBe(ctx.nodeBin);
    expect(parsed.mcp_servers.cavemem.args).toEqual([ctx.cliPath, 'mcp']);

    const hooks = JSON.parse(readFileSync(hooksJson(), 'utf8')) as {
      hooks: Record<string, Array<{ hooks: Array<{ command: string; statusMessage?: string }> }>>;
    };
    expect(Object.keys(hooks.hooks).sort()).toEqual(
      ['PostToolUse', 'SessionStart', 'Stop', 'UserPromptSubmit'].sort(),
    );
    expect(hooks.hooks.SessionStart?.[0]?.hooks?.[0]?.command).toBe(
      `${ctx.nodeBin} ${ctx.cliPath} hook run session-start --ide codex`,
    );
    expect(hooks.hooks.SessionStart?.[0]?.hooks?.[0]?.statusMessage).toBe(
      'Loading cavemem context',
    );
    expect(hooks.hooks.PostToolUse?.[0]?.hooks?.[0]?.statusMessage).toBeUndefined();
  });

  it('preserves user TOML keys and is idempotent', async () => {
    mkdirSync(join(home, '.codex'), { recursive: true });
    writeFileSync(
      cfg(),
      [
        'model = "gpt-5"',
        '',
        '[features]',
        'web_search = true',
        '',
        '[mcp_servers.other]',
        'command = "/other/bin"',
        '',
      ].join('\n'),
    );

    await codex.install(ctx);
    await codex.install(ctx);

    const parsed = parseToml(readFileSync(cfg(), 'utf8')) as {
      model: string;
      features: { codex_hooks: boolean; web_search: boolean };
      mcp_servers: Record<string, { command: string; args?: string[] }>;
    };
    expect(parsed.model).toBe('gpt-5');
    expect(parsed.features.web_search).toBe(true);
    expect(parsed.features.codex_hooks).toBe(true);
    expect(parsed.mcp_servers.other?.command).toBe('/other/bin');
    expect(parsed.mcp_servers.cavemem?.command).toBe(ctx.nodeBin);

    const hooks = JSON.parse(readFileSync(hooksJson(), 'utf8')) as {
      hooks: Record<string, Array<unknown>>;
    };
    // Idempotent: each event has exactly one cavemem entry.
    for (const name of ['SessionStart', 'UserPromptSubmit', 'PostToolUse', 'Stop']) {
      expect(hooks.hooks[name]?.length).toBe(1);
    }
  });

  it('uninstall removes only cavemem entries', async () => {
    mkdirSync(join(home, '.codex'), { recursive: true });
    writeFileSync(
      hooksJson(),
      JSON.stringify({
        hooks: {
          SessionStart: [{ hooks: [{ type: 'command', command: 'echo other' }] }],
        },
      }),
    );

    await codex.install(ctx);
    await codex.uninstall(ctx);

    const parsed = parseToml(readFileSync(cfg(), 'utf8')) as {
      features: { codex_hooks: boolean };
      mcp_servers?: Record<string, unknown>;
    };
    // Feature stays on; mcp_servers.cavemem gone.
    expect(parsed.features.codex_hooks).toBe(true);
    expect(parsed.mcp_servers).toBeUndefined();

    const hooks = JSON.parse(readFileSync(hooksJson(), 'utf8')) as {
      hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
    };
    expect(hooks.hooks.SessionStart?.length).toBe(1);
    expect(hooks.hooks.SessionStart?.[0]?.hooks?.[0]?.command).toBe('echo other');
    expect(hooks.hooks.PostToolUse).toBeUndefined();
  });
});

describe('opencode installer', () => {
  // The installer reads ~/.config/opencode/ when XDG_CONFIG_HOME is unset.
  // Force XDG_CONFIG_HOME to a path inside the temp home so writes stay
  // sandboxed even on systems where ~/.config/opencode/ already exists.
  let originalXdg: string | undefined;
  beforeEach(() => {
    originalXdg = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = join(home, '.config');
  });
  afterEach(() => {
    if (originalXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = originalXdg;
  });

  const cfgPath = () => join(home, '.config', 'opencode', 'opencode.json');
  const pluginPath = () => join(home, '.config', 'opencode', 'plugins', 'cavemem.js');

  it('writes opencode.json + plugin file', async () => {
    await openCode.install(ctx);
    expect(existsSync(cfgPath())).toBe(true);
    expect(existsSync(pluginPath())).toBe(true);

    const cfg = JSON.parse(readFileSync(cfgPath(), 'utf8')) as {
      mcpServers: Record<string, { command: string; args: string[] }>;
      plugin: string[];
    };
    expect(cfg.mcpServers.cavemem).toEqual({
      command: ctx.nodeBin,
      args: [ctx.cliPath, 'mcp'],
    });
    expect(cfg.plugin).toContain('file://./plugins/cavemem.js');

    const plugin = readFileSync(pluginPath(), 'utf8');
    expect(plugin).toContain('const NODE = ');
    expect(plugin).toContain("'tool.execute.after'");
    expect(plugin).toContain("'post-tool-use'");
    expect(plugin).toContain("'session-start'");
    // Plugin must NOT block the IDE — must use detached spawn.
    expect(plugin).toContain('detached: true');
  });

  it('uninstall removes plugin file and cavemem entries, leaves user keys', async () => {
    mkdirSync(join(home, '.config', 'opencode'), { recursive: true });
    writeFileSync(
      cfgPath(),
      JSON.stringify({
        theme: 'dark',
        mcpServers: { other: { command: '/other/bin' } },
        plugin: ['some-other-plugin'],
      }),
    );

    await openCode.install(ctx);
    await openCode.uninstall(ctx);

    const cfg = JSON.parse(readFileSync(cfgPath(), 'utf8')) as {
      theme: string;
      mcpServers: Record<string, unknown>;
      plugin: string[];
    };
    expect(cfg.theme).toBe('dark');
    expect(cfg.mcpServers.other).toEqual({ command: '/other/bin' });
    expect(cfg.mcpServers.cavemem).toBeUndefined();
    expect(cfg.plugin).toEqual(['some-other-plugin']);
    expect(existsSync(pluginPath())).toBe(false);
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
    expect(cfg.mcpServers.cavemem).toEqual({
      command: ctx.nodeBin,
      args: [ctx.cliPath, 'mcp'],
    });

    await cursor.uninstall(ctx);
    const after = JSON.parse(readFileSync(p, 'utf8')) as typeof cfg;
    expect(after.mcpServers.cavemem).toBeUndefined();
  });
});
