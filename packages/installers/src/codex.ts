import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';
import { readJson, writeJson } from './fs-utils.js';
import type { InstallContext, Installer } from './types.js';

interface CodexHookCommand {
  type: 'command';
  command: string;
  statusMessage?: string;
}

interface CodexHookGroup {
  hooks: CodexHookCommand[];
}

interface CodexHooksFile {
  hooks?: Record<string, CodexHookGroup[]>;
}

const HOOK_NAMES: Array<[string, string, string?]> = [
  ['SessionStart', 'session-start', 'Loading cavemem context'],
  ['UserPromptSubmit', 'user-prompt-submit'],
  ['PostToolUse', 'post-tool-use'],
  ['Stop', 'stop'],
];

function configFile(ctx: InstallContext): string {
  return join(ctx.ideConfigDir, '.codex', 'config.toml');
}

function hooksFile(ctx: InstallContext): string {
  return join(ctx.ideConfigDir, '.codex', 'hooks.json');
}

function legacyConfigFile(ctx: InstallContext): string {
  // Earlier versions of this installer wrote a JSON config that Codex never
  // read. Cleaned up on uninstall.
  return join(ctx.ideConfigDir, '.codex', 'config.json');
}

function isCavememHookGroup(group: CodexHookGroup, hookId: string): boolean {
  return group.hooks.some((h) => h.type === 'command' && h.command.includes(`hook run ${hookId}`));
}

// smol-toml round-trips most config.toml shapes, but it does not support
// inline tables for arbitrary user content. We accept that limitation: if a
// user has hand-written exotic TOML, parsing should still work; re-emission
// uses the canonical multi-line form.
function readToml(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  try {
    return parseToml(readFileSync(path, 'utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function writeToml(path: string, data: Record<string, unknown>): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${stringifyToml(data)}\n`, 'utf8');
}

export const codex: Installer = {
  id: 'codex',
  label: 'Codex CLI',
  async detect(ctx: InstallContext): Promise<boolean> {
    return existsSync(join(ctx.ideConfigDir, '.codex'));
  },
  async install(ctx: InstallContext): Promise<string[]> {
    const messages: string[] = [];
    const cfgPath = configFile(ctx);
    const hooksPath = hooksFile(ctx);

    // ---- config.toml: features.codex_hooks + mcp_servers.cavemem ----
    const cfg = readToml(cfgPath);

    const features = (cfg.features as Record<string, unknown> | undefined) ?? {};
    features.codex_hooks = true;
    cfg.features = features;

    const mcpServers =
      (cfg.mcp_servers as Record<string, Record<string, unknown>> | undefined) ?? {};
    mcpServers.cavemem = {
      command: ctx.nodeBin,
      args: [ctx.cliPath, 'mcp'],
    };
    cfg.mcp_servers = mcpServers;

    writeToml(cfgPath, cfg);
    messages.push(`wrote ${cfgPath}`);

    // ---- hooks.json: register cavemem entries; preserve user hooks ----
    const hooks = readJson<CodexHooksFile>(hooksPath, {});
    const hookMap: Record<string, CodexHookGroup[]> = { ...(hooks.hooks ?? {}) };

    for (const [eventName, hookId, statusMessage] of HOOK_NAMES) {
      const existing = hookMap[eventName] ?? [];
      const others = existing.filter((g) => !isCavememHookGroup(g, hookId));
      const group: CodexHookGroup = {
        hooks: [
          {
            type: 'command',
            command: `${ctx.nodeBin} ${ctx.cliPath} hook run ${hookId} --ide codex`,
            ...(statusMessage ? { statusMessage } : {}),
          },
        ],
      };
      others.push(group);
      hookMap[eventName] = others;
    }

    writeJson(hooksPath, { ...hooks, hooks: hookMap });
    messages.push(`wrote ${hooksPath}`);

    return messages;
  },
  async uninstall(ctx: InstallContext): Promise<string[]> {
    const messages: string[] = [];
    const cfgPath = configFile(ctx);
    const hooksPath = hooksFile(ctx);
    const legacy = legacyConfigFile(ctx);

    if (existsSync(cfgPath)) {
      const cfg = readToml(cfgPath);
      const mcpServers = cfg.mcp_servers as Record<string, unknown> | undefined;
      if (mcpServers && 'cavemem' in mcpServers) {
        delete mcpServers.cavemem;
        if (Object.keys(mcpServers).length === 0) delete cfg.mcp_servers;
      }
      // Leave [features] codex_hooks alone — turning it off would break any
      // other tools that rely on it. The hooks.json cleanup below is enough
      // to stop cavemem hooks from firing.
      writeToml(cfgPath, cfg);
      messages.push(`updated ${cfgPath}`);
    }

    if (existsSync(hooksPath)) {
      const hooks = readJson<CodexHooksFile>(hooksPath, {});
      if (hooks.hooks) {
        for (const [eventName, hookId] of HOOK_NAMES) {
          const arr = hooks.hooks[eventName];
          if (!arr) continue;
          const remaining = arr.filter((g) => !isCavememHookGroup(g, hookId));
          if (remaining.length === 0) delete hooks.hooks[eventName];
          else hooks.hooks[eventName] = remaining;
        }
      }
      writeJson(hooksPath, hooks);
      messages.push(`updated ${hooksPath}`);
    }

    if (existsSync(legacy)) {
      const cur = readJson<{ mcpServers?: Record<string, unknown> }>(legacy, {});
      if (cur.mcpServers) {
        delete cur.mcpServers.cavemem;
        if (Object.keys(cur.mcpServers).length === 0) delete cur.mcpServers;
      }
      writeJson(legacy, cur);
      messages.push(`updated ${legacy}`);
    }

    return messages;
  },
};
