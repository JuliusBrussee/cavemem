import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { antigravity } from '../src/antigravity.js';
import { augment } from '../src/augment.js';
import { bob } from '../src/bob.js';
import { claudeCode } from '../src/claude-code.js';
import { codex } from '../src/codex.js';
import { copilot } from '../src/copilot.js';
import { cursor } from '../src/cursor.js';
import { deepMerge } from '../src/fs-utils.js';
import { openCode } from '../src/opencode.js';
import { getInstaller, installers } from '../src/registry.js';
import type { InstallContext } from '../src/types.js';
import { checkWindowsSh, resolveShDefault } from '../src/windows-sh.js';

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

  // Place the fake CLI and bridge inside the temp dir so the opencode
  // installer can create a real symlink during install.
  const fakeDist = join(home, 'cavemem', 'dist');
  mkdirSync(fakeDist, { recursive: true });
  writeFileSync(join(fakeDist, 'opencodeBridge.js'), '// fake bridge\n');

  ctx = {
    ideConfigDir: home,
    cliPath: join(fakeDist, 'index.js'),
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
      [
        'claude-code',
        'codex',
        'cursor',
        'gemini-cli',
        'opencode',
        'copilot',
        'augment',
        'antigravity',
        'bob',
      ].sort(),
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

  it('writes opencode.json with mcp schema + symlinks bridge plugin', async () => {
    await openCode.install(ctx);
    expect(existsSync(cfgPath())).toBe(true);
    expect(existsSync(pluginPath())).toBe(true);

    const cfg = JSON.parse(readFileSync(cfgPath(), 'utf8')) as {
      mcp: Record<string, { type: string; command: string[]; enabled: boolean }>;
      plugin: string[];
    };
    expect(cfg.mcp.cavemem).toEqual({
      type: 'local',
      command: [ctx.nodeBin, ctx.cliPath, 'mcp'],
      enabled: true,
    });
    expect(cfg.plugin).toContain('file://./plugins/cavemem.js');

    // Plugin must be a symlink to the bundled bridge file.
    const plugin = readFileSync(pluginPath(), 'utf8');
    expect(plugin).toContain('// fake bridge');
  });

  it('is idempotent on re-install', async () => {
    await openCode.install(ctx);
    await openCode.install(ctx);

    const cfg = JSON.parse(readFileSync(cfgPath(), 'utf8')) as {
      mcp: Record<string, unknown>;
      plugin: string[];
    };
    expect(Object.keys(cfg.mcp)).toEqual(['cavemem']);
    expect(cfg.plugin).toContain('file://./plugins/cavemem.js');

    expect(existsSync(pluginPath())).toBe(true);
  });

  it('migrates a stale mcpServers.cavemem entry out of the modern config file on install', async () => {
    // A prior installer version wrote mcpServers.cavemem straight into
    // ~/.config/opencode/opencode.json (the wrong key — OpenCode expects
    // `mcp`). Re-running install with the current installer must clean up
    // that orphaned entry, not just add the new mcp.cavemem key alongside it.
    mkdirSync(join(home, '.config', 'opencode'), { recursive: true });
    writeFileSync(
      cfgPath(),
      JSON.stringify({
        mcpServers: { cavemem: { command: 'old', args: ['mcp'] }, keep: { command: '/keep' } },
      }),
    );

    await openCode.install(ctx);
    const cfg = JSON.parse(readFileSync(cfgPath(), 'utf8')) as {
      mcp: Record<string, unknown>;
      mcpServers?: Record<string, unknown>;
    };
    expect(cfg.mcp.cavemem).toBeDefined();
    expect(cfg.mcpServers?.cavemem).toBeUndefined();
    expect(cfg.mcpServers?.keep).toEqual({ command: '/keep' });
  });

  it('preserves unrelated user settings on install + uninstall', async () => {
    mkdirSync(join(home, '.config', 'opencode'), { recursive: true });
    writeFileSync(
      cfgPath(),
      JSON.stringify({
        theme: 'dark',
        mcp: { other: { type: 'local', command: ['echo'], enabled: true } },
        plugin: ['some-other-plugin'],
      }),
    );

    await openCode.install(ctx);
    const installed = JSON.parse(readFileSync(cfgPath(), 'utf8')) as {
      theme: string;
      mcp: Record<string, unknown>;
      plugin: string[];
    };
    expect(installed.theme).toBe('dark');
    expect(installed.mcp.other).toBeDefined();
    expect(installed.mcp.cavemem).toBeDefined();
    expect(installed.plugin).toContain('some-other-plugin');
    expect(installed.plugin).toContain('file://./plugins/cavemem.js');

    await openCode.uninstall(ctx);
    const after = JSON.parse(readFileSync(cfgPath(), 'utf8')) as typeof installed;
    expect(after.theme).toBe('dark');
    expect(after.mcp.other).toBeDefined();
    expect(after.mcp.cavemem).toBeUndefined();
    expect(after.plugin).toEqual(['some-other-plugin']);
    expect(existsSync(pluginPath())).toBe(false);
  });

  it('cleans up legacy config on uninstall', async () => {
    const legacyPath = join(home, '.opencode', 'config.json');
    mkdirSync(join(home, '.opencode'), { recursive: true });
    writeFileSync(
      legacyPath,
      JSON.stringify({
        mcpServers: { cavemem: { command: '/old/bin' } },
      }),
    );

    await openCode.uninstall(ctx);
    const legacy = JSON.parse(readFileSync(legacyPath, 'utf8')) as {
      mcpServers?: Record<string, unknown>;
    };
    expect(legacy.mcpServers?.cavemem).toBeUndefined();
  });

  it('detect returns true when ~/.config/opencode exists', async () => {
    expect(await openCode.detect(ctx)).toBe(false);
    mkdirSync(join(home, '.config', 'opencode'), { recursive: true });
    expect(await openCode.detect(ctx)).toBe(true);
  });

  it('detect falls back to legacy ~/.opencode path', async () => {
    expect(await openCode.detect(ctx)).toBe(false);
    mkdirSync(join(home, '.opencode'));
    expect(await openCode.detect(ctx)).toBe(true);
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

describe('checkWindowsSh (#56)', () => {
  it('warns when sh is missing on win32', () => {
    const warning = checkWindowsSh({ platform: 'win32', resolveSh: () => false });
    expect(warning).toContain('sh` not found on PATH');
    expect(warning).toContain('Git\\bin');
    expect(warning).toContain('where.exe sh');
  });

  it('returns null when sh resolves on win32', () => {
    expect(checkWindowsSh({ platform: 'win32', resolveSh: () => true })).toBeNull();
  });

  it('is a no-op on non-Windows platforms, even if the resolver would fail', () => {
    const resolveSh = () => false;
    expect(checkWindowsSh({ platform: 'darwin', resolveSh })).toBeNull();
    expect(checkWindowsSh({ platform: 'linux', resolveSh })).toBeNull();
  });

  it('defaults to process.platform and resolveShDefault when no options are given', () => {
    // On the non-Windows machines this suite runs on, the default platform
    // branch is a no-op regardless of whether `sh` is actually resolvable.
    expect(checkWindowsSh()).toBeNull();
  });

  it('resolveShDefault returns a boolean without throwing', () => {
    expect(typeof resolveShDefault()).toBe('boolean');
  });
});

// vscodeUserDir/wrapper emission branch on process.platform, which vitest
// cannot set via env — swap the property for the duration of the callback.
async function withPlatform(platform: string, fn: () => Promise<void>): Promise<void> {
  const original = process.platform;
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  try {
    await fn();
  } finally {
    Object.defineProperty(process, 'platform', { value: original, configurable: true });
  }
}

describe('copilot installer', () => {
  // Pin the linux branch + XDG so the VS Code user dir is deterministic
  // inside the temp home regardless of the host OS.
  let originalXdg: string | undefined;
  beforeEach(() => {
    originalXdg = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = join(home, '.config');
  });
  afterEach(() => {
    if (originalXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = originalXdg;
  });

  const hooksPath = () => join(home, '.copilot', 'hooks', 'cavemem.json');
  const mcpPath = () => join(home, '.config', 'Code', 'User', 'mcp.json');

  it('writes hooks to ~/.copilot/hooks/cavemem.json and MCP to VS Code user mcp.json', async () => {
    await withPlatform('linux', async () => {
      await copilot.install(ctx);
    });
    expect(existsSync(hooksPath())).toBe(true);
    expect(existsSync(mcpPath())).toBe(true);

    const hooks = JSON.parse(readFileSync(hooksPath(), 'utf8')) as {
      hooks: Record<string, Array<{ type: string; command: string }>>;
    };
    expect(Object.keys(hooks.hooks).sort()).toEqual(
      ['PostToolUse', 'SessionStart', 'Stop', 'UserPromptSubmit'].sort(),
    );
    expect(hooks.hooks.SessionStart?.[0]?.command).toBe(
      `${ctx.nodeBin} ${ctx.cliPath} hook run session-start --ide copilot`,
    );

    const mcp = JSON.parse(readFileSync(mcpPath(), 'utf8')) as {
      servers: Record<string, { type: string; command: string; args: string[] }>;
    };
    // VS Code's root key is `servers` (not `mcpServers`) and stdio entries
    // carry an explicit type.
    expect(mcp.servers.cavemem).toEqual({
      type: 'stdio',
      command: ctx.nodeBin,
      args: [ctx.cliPath, 'mcp'],
    });
  });

  it('is idempotent on re-install', async () => {
    await withPlatform('linux', async () => {
      await copilot.install(ctx);
      await copilot.install(ctx);
    });
    const hooks = JSON.parse(readFileSync(hooksPath(), 'utf8')) as {
      hooks: Record<string, Array<unknown>>;
    };
    for (const name of ['SessionStart', 'UserPromptSubmit', 'PostToolUse', 'Stop']) {
      expect(hooks.hooks[name]?.length).toBe(1);
    }
    const mcp = JSON.parse(readFileSync(mcpPath(), 'utf8')) as {
      servers: Record<string, unknown>;
    };
    expect(Object.keys(mcp.servers)).toEqual(['cavemem']);
  });

  it('preserves hand-added entries in its hooks file and unrelated MCP servers', async () => {
    mkdirSync(join(home, '.copilot', 'hooks'), { recursive: true });
    writeFileSync(
      hooksPath(),
      JSON.stringify({
        hooks: {
          SessionStart: [{ type: 'command', command: 'echo user-added' }],
          PreCompact: [{ type: 'command', command: 'echo compact' }],
        },
      }),
    );
    mkdirSync(join(home, '.config', 'Code', 'User'), { recursive: true });
    writeFileSync(
      mcpPath(),
      JSON.stringify({
        servers: { other: { type: 'stdio', command: '/other/bin' } },
        inputs: [{ id: 'token', type: 'promptString' }],
      }),
    );

    await withPlatform('linux', async () => {
      await copilot.install(ctx);
    });

    const hooks = JSON.parse(readFileSync(hooksPath(), 'utf8')) as {
      hooks: Record<string, Array<{ command: string }>>;
    };
    expect(hooks.hooks.SessionStart?.length).toBe(2);
    expect(hooks.hooks.SessionStart?.[0]?.command).toBe('echo user-added');
    expect(hooks.hooks.PreCompact?.length).toBe(1);

    const mcp = JSON.parse(readFileSync(mcpPath(), 'utf8')) as {
      servers: Record<string, unknown>;
      inputs: unknown[];
    };
    expect(mcp.servers.other).toEqual({ type: 'stdio', command: '/other/bin' });
    expect(mcp.servers.cavemem).toBeDefined();
    expect(mcp.inputs.length).toBe(1);
  });

  it('uninstall deletes its own hooks file when only cavemem entries exist', async () => {
    await withPlatform('linux', async () => {
      await copilot.install(ctx);
      await copilot.uninstall(ctx);
    });
    expect(existsSync(hooksPath())).toBe(false);
    const mcp = JSON.parse(readFileSync(mcpPath(), 'utf8')) as {
      servers?: Record<string, unknown>;
    };
    expect(mcp.servers?.cavemem).toBeUndefined();
  });

  it('uninstall keeps the hooks file when user entries remain', async () => {
    mkdirSync(join(home, '.copilot', 'hooks'), { recursive: true });
    writeFileSync(
      hooksPath(),
      JSON.stringify({
        hooks: { SessionStart: [{ type: 'command', command: 'echo user-added' }] },
      }),
    );
    await withPlatform('linux', async () => {
      await copilot.install(ctx);
      await copilot.uninstall(ctx);
    });
    const hooks = JSON.parse(readFileSync(hooksPath(), 'utf8')) as {
      hooks: Record<string, Array<{ command: string }>>;
    };
    expect(hooks.hooks.SessionStart?.length).toBe(1);
    expect(hooks.hooks.SessionStart?.[0]?.command).toBe('echo user-added');
    expect(hooks.hooks.PostToolUse).toBeUndefined();
  });

  it('routes mcp.json to Library/Application Support on darwin', async () => {
    await withPlatform('darwin', async () => {
      await copilot.install(ctx);
    });
    expect(
      existsSync(join(home, 'Library', 'Application Support', 'Code', 'User', 'mcp.json')),
    ).toBe(true);
  });

  it('routes mcp.json through APPDATA on win32', async () => {
    const originalAppData = process.env.APPDATA;
    process.env.APPDATA = join(home, 'Roaming');
    try {
      await withPlatform('win32', async () => {
        await copilot.install(ctx);
      });
      expect(existsSync(join(home, 'Roaming', 'Code', 'User', 'mcp.json'))).toBe(true);
    } finally {
      if (originalAppData === undefined) delete process.env.APPDATA;
      else process.env.APPDATA = originalAppData;
    }
  });

  it('falls back to ideConfigDir/AppData/Roaming on win32 without APPDATA', async () => {
    const originalAppData = process.env.APPDATA;
    delete process.env.APPDATA;
    try {
      await withPlatform('win32', async () => {
        await copilot.install(ctx);
      });
      expect(existsSync(join(home, 'AppData', 'Roaming', 'Code', 'User', 'mcp.json'))).toBe(true);
    } finally {
      if (originalAppData !== undefined) process.env.APPDATA = originalAppData;
    }
  });

  it('quotes paths with spaces in hook command strings (Windows)', async () => {
    const winCtx: InstallContext = {
      ideConfigDir: home,
      cliPath: 'C:\\Users\\Some User\\AppData\\Roaming\\npm\\node_modules\\cavemem\\dist\\index.js',
      nodeBin: 'C:\\Program Files\\nodejs\\node.exe',
      dataDir: join(home, '.cavemem'),
    };
    // Pin the linux mcp.json branch — only the hook command quoting is under
    // test; the path strings are opaque to join().
    await withPlatform('linux', async () => {
      await copilot.install(winCtx);
    });
    const hooks = JSON.parse(readFileSync(hooksPath(), 'utf8')) as {
      hooks: Record<string, Array<{ command: string }>>;
    };
    expect(hooks.hooks.SessionStart?.[0]?.command).toBe(
      `"${winCtx.nodeBin}" "${winCtx.cliPath}" hook run session-start --ide copilot`,
    );
  });

  it('detect returns true only when ~/.copilot exists', async () => {
    expect(await copilot.detect(ctx)).toBe(false);
    mkdirSync(join(home, '.copilot'));
    expect(await copilot.detect(ctx)).toBe(true);
  });
});

describe('augment installer', () => {
  const settingsPath = () => join(home, '.augment', 'settings.json');
  const wrapperDir = () => join(home, '.augment', 'cavemem-hooks');

  it('writes executable wrapper scripts and settings.json with hooks + mcpServers', async () => {
    await withPlatform('linux', async () => {
      await augment.install(ctx);
    });

    for (const hookId of ['session-start', 'post-tool-use', 'stop', 'session-end']) {
      const wrapper = join(wrapperDir(), `${hookId}.sh`);
      expect(existsSync(wrapper)).toBe(true);
      expect(statSync(wrapper).mode & 0o111).toBeTruthy();
      const body = readFileSync(wrapper, 'utf8');
      expect(body).toContain(`hook run ${hookId} --ide augment`);
      expect(body.startsWith('#!/bin/sh\n')).toBe(true);
    }

    const settings = JSON.parse(readFileSync(settingsPath(), 'utf8')) as {
      hooks: Record<
        string,
        Array<{ matcher?: string; hooks: Array<{ command: string; metadata?: unknown }> }>
      >;
      mcpServers: Record<string, { command: string; args: string[] }>;
    };
    // Augment has no UserPromptSubmit event.
    expect(Object.keys(settings.hooks).sort()).toEqual(
      ['PostToolUse', 'SessionEnd', 'SessionStart', 'Stop'].sort(),
    );
    // Hook commands must be script-file paths, not inline command strings.
    expect(settings.hooks.SessionStart?.[0]?.hooks?.[0]?.command).toBe(
      join(wrapperDir(), 'session-start.sh'),
    );
    // Tool events require a matcher; session events must not carry one.
    expect(settings.hooks.PostToolUse?.[0]?.matcher).toBe('.*');
    expect(settings.hooks.SessionStart?.[0]?.matcher).toBeUndefined();
    expect(settings.mcpServers.cavemem).toEqual({
      command: ctx.nodeBin,
      args: [ctx.cliPath, 'mcp'],
    });
  });

  it('sets includeConversationData on the Stop hook only', async () => {
    await withPlatform('linux', async () => {
      await augment.install(ctx);
    });
    const settings = JSON.parse(readFileSync(settingsPath(), 'utf8')) as {
      hooks: Record<string, Array<{ hooks: Array<{ metadata?: Record<string, unknown> }> }>>;
    };
    // Without this flag Augment's Stop payload has no assistant text at all,
    // so turn-summary capture would silently store nothing.
    expect(settings.hooks.Stop?.[0]?.hooks?.[0]?.metadata).toEqual({
      includeConversationData: true,
    });
    expect(settings.hooks.SessionStart?.[0]?.hooks?.[0]?.metadata).toBeUndefined();
    expect(settings.hooks.PostToolUse?.[0]?.hooks?.[0]?.metadata).toBeUndefined();
  });

  it('emits .cmd wrappers on win32', async () => {
    await withPlatform('win32', async () => {
      await augment.install(ctx);
    });
    const wrapper = join(wrapperDir(), 'session-start.cmd');
    expect(existsSync(wrapper)).toBe(true);
    const body = readFileSync(wrapper, 'utf8');
    expect(body.startsWith('@echo off\r\n')).toBe(true);
    expect(body).toContain('hook run session-start --ide augment');
    const settings = JSON.parse(readFileSync(settingsPath(), 'utf8')) as {
      hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
    };
    expect(settings.hooks.SessionStart?.[0]?.hooks?.[0]?.command).toBe(wrapper);
  });

  it('is idempotent on re-install', async () => {
    await withPlatform('linux', async () => {
      await augment.install(ctx);
      await augment.install(ctx);
    });
    const settings = JSON.parse(readFileSync(settingsPath(), 'utf8')) as {
      hooks: Record<string, Array<unknown>>;
      mcpServers: Record<string, unknown>;
    };
    for (const name of ['SessionStart', 'PostToolUse', 'Stop', 'SessionEnd']) {
      expect(settings.hooks[name]?.length).toBe(1);
    }
    expect(Object.keys(settings.mcpServers)).toEqual(['cavemem']);
  });

  it('preserves unrelated settings on install and uninstall; removes wrapper dir', async () => {
    mkdirSync(join(home, '.augment'), { recursive: true });
    writeFileSync(
      settingsPath(),
      JSON.stringify({
        theme: 'dark',
        hooks: {
          SessionStart: [{ hooks: [{ type: 'command', command: '/user/own.sh' }] }],
          PreToolUse: [{ matcher: '.*', hooks: [{ type: 'command', command: '/user/pre.sh' }] }],
        },
        mcpServers: { other: { command: '/other/bin' } },
      }),
    );

    await withPlatform('linux', async () => {
      await augment.install(ctx);
    });
    const installed = JSON.parse(readFileSync(settingsPath(), 'utf8')) as {
      theme: string;
      hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
      mcpServers: Record<string, unknown>;
    };
    expect(installed.theme).toBe('dark');
    expect(installed.hooks.SessionStart?.length).toBe(2);
    expect(installed.hooks.SessionStart?.[0]?.hooks?.[0]?.command).toBe('/user/own.sh');
    expect(installed.hooks.PreToolUse?.length).toBe(1);
    expect(installed.mcpServers.other).toEqual({ command: '/other/bin' });

    await withPlatform('linux', async () => {
      await augment.uninstall(ctx);
    });
    const after = JSON.parse(readFileSync(settingsPath(), 'utf8')) as typeof installed;
    expect(after.theme).toBe('dark');
    expect(after.hooks.SessionStart?.length).toBe(1);
    expect(after.hooks.SessionStart?.[0]?.hooks?.[0]?.command).toBe('/user/own.sh');
    expect(after.hooks.PreToolUse?.length).toBe(1);
    expect(after.hooks.Stop).toBeUndefined();
    expect(after.mcpServers.other).toBeDefined();
    expect((after.mcpServers as Record<string, unknown>).cavemem).toBeUndefined();
    expect(existsSync(wrapperDir())).toBe(false);
  });

  it('detect returns true only when ~/.augment exists', async () => {
    expect(await augment.detect(ctx)).toBe(false);
    mkdirSync(join(home, '.augment'));
    expect(await augment.detect(ctx)).toBe(true);
  });
});

describe('antigravity installer (query-only)', () => {
  const cfgPath = () => join(home, '.gemini', 'config', 'mcp_config.json');

  it('writes MCP config and warns that capture is unavailable', async () => {
    const messages = await antigravity.install(ctx);
    const cfg = JSON.parse(readFileSync(cfgPath(), 'utf8')) as {
      mcpServers: Record<string, { command: string; args?: string[] }>;
    };
    expect(cfg.mcpServers.cavemem).toEqual({
      command: ctx.nodeBin,
      args: [ctx.cliPath, 'mcp'],
    });
    expect(messages.some((m) => m.includes('query-only'))).toBe(true);
  });

  it('preserves other servers and uninstalls cleanly', async () => {
    mkdirSync(join(home, '.gemini', 'config'), { recursive: true });
    writeFileSync(cfgPath(), JSON.stringify({ mcpServers: { other: { command: '/x' } } }));
    await antigravity.install(ctx);
    await antigravity.uninstall(ctx);
    const cfg = JSON.parse(readFileSync(cfgPath(), 'utf8')) as {
      mcpServers: Record<string, unknown>;
    };
    expect(cfg.mcpServers.other).toEqual({ command: '/x' });
    expect(cfg.mcpServers.cavemem).toBeUndefined();
  });

  it('uninstall without a config file writes nothing', async () => {
    const messages = await antigravity.uninstall(ctx);
    expect(messages).toEqual([]);
    expect(existsSync(cfgPath())).toBe(false);
  });

  it('uninstall drops the mcpServers key when it becomes empty', async () => {
    await antigravity.install(ctx);
    await antigravity.uninstall(ctx);
    const cfg = JSON.parse(readFileSync(cfgPath(), 'utf8')) as {
      mcpServers?: Record<string, unknown>;
    };
    expect(cfg.mcpServers).toBeUndefined();
  });

  it('detect returns true only when ~/.gemini/config exists', async () => {
    expect(await antigravity.detect(ctx)).toBe(false);
    mkdirSync(join(home, '.gemini', 'config'), { recursive: true });
    expect(await antigravity.detect(ctx)).toBe(true);
  });
});

describe('bob installer (query-only)', () => {
  const cfgPath = () => join(home, '.bob', 'mcp.json');

  it('writes MCP config and warns that capture is unavailable', async () => {
    const messages = await bob.install(ctx);
    const cfg = JSON.parse(readFileSync(cfgPath(), 'utf8')) as {
      mcpServers: Record<string, { command: string; args?: string[] }>;
    };
    expect(cfg.mcpServers.cavemem).toEqual({
      command: ctx.nodeBin,
      args: [ctx.cliPath, 'mcp'],
    });
    expect(messages.some((m) => m.includes('query-only'))).toBe(true);
  });

  it('preserves other servers and uninstalls cleanly', async () => {
    mkdirSync(join(home, '.bob'), { recursive: true });
    writeFileSync(cfgPath(), JSON.stringify({ mcpServers: { other: { command: '/x' } } }));
    await bob.install(ctx);
    await bob.uninstall(ctx);
    const cfg = JSON.parse(readFileSync(cfgPath(), 'utf8')) as {
      mcpServers: Record<string, unknown>;
    };
    expect(cfg.mcpServers.other).toEqual({ command: '/x' });
    expect(cfg.mcpServers.cavemem).toBeUndefined();
  });

  it('uninstall without a config file writes nothing', async () => {
    const messages = await bob.uninstall(ctx);
    expect(messages).toEqual([]);
    expect(existsSync(cfgPath())).toBe(false);
  });

  it('uninstall drops the mcpServers key when it becomes empty', async () => {
    await bob.install(ctx);
    await bob.uninstall(ctx);
    const cfg = JSON.parse(readFileSync(cfgPath(), 'utf8')) as {
      mcpServers?: Record<string, unknown>;
    };
    expect(cfg.mcpServers).toBeUndefined();
  });

  it('detect returns true only when ~/.bob exists', async () => {
    expect(await bob.detect(ctx)).toBe(false);
    mkdirSync(join(home, '.bob'));
    expect(await bob.detect(ctx)).toBe(true);
  });
});
