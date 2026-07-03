import {
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { deepMerge, readJson, writeJson } from './fs-utils.js';
import type { InstallContext, Installer } from './types.js';

interface OpenCodeConfig {
  mcp?: Record<
    string,
    {
      type: string;
      command: string[];
      enabled: boolean;
    }
  >;
  mcpServers?: Record<string, { command: string; args?: string[] }>;
  plugin?: string[];
}

function configRoot(ctx: InstallContext): string {
  // Per OpenCode docs, the user-global config dir is ~/.config/opencode/.
  // We honor XDG_CONFIG_HOME if set.
  const xdg = process.env.XDG_CONFIG_HOME;
  return xdg ? join(xdg, 'opencode') : join(ctx.ideConfigDir, '.config', 'opencode');
}

function configFile(ctx: InstallContext): string {
  return join(configRoot(ctx), 'opencode.json');
}

function pluginDir(ctx: InstallContext): string {
  return join(configRoot(ctx), 'plugins');
}

function pluginLink(ctx: InstallContext): string {
  return join(pluginDir(ctx), 'cavemem.js');
}

// Legacy locations from earlier versions of this installer. Cleaned up on
// uninstall so users don't end up with stale files.
function legacyConfigFile(ctx: InstallContext): string {
  return join(ctx.ideConfigDir, '.opencode', 'config.json');
}

export const openCode: Installer = {
  id: 'opencode',
  label: 'OpenCode',
  async detect(ctx: InstallContext): Promise<boolean> {
    // Prefer the modern XDG path; fall back to the legacy dot-dir.
    return existsSync(configRoot(ctx)) || existsSync(join(ctx.ideConfigDir, '.opencode'));
  },
  async install(ctx: InstallContext): Promise<string[]> {
    const messages: string[] = [];

    // 1. Write MCP config to the correct OpenCode config file.
    const path = configFile(ctx);
    const current = readJson<OpenCodeConfig>(path, {});
    const next = deepMerge<OpenCodeConfig>(current, {
      mcp: {
        cavemem: {
          type: 'local',
          command: [ctx.nodeBin, ctx.cliPath, 'mcp'],
          enabled: true,
        },
      },
    });
    // Migrate away from the old `mcpServers` key a prior installer version
    // wrote into this same file (OpenCode never read it — it expects `mcp`).
    // Without this, upgrading in place leaves a stale, orphaned entry behind.
    if (next.mcpServers?.cavemem) {
      delete next.mcpServers.cavemem;
      if (Object.keys(next.mcpServers).length === 0) delete next.mcpServers;
    }
    // Ensure the bundled bridge plugin is listed so OpenCode auto-loads it.
    // Plugins in plugins/ also auto-load, but listing in `plugin` makes intent
    // explicit and survives plugin-dir overrides.
    const pluginList = Array.from(new Set([...(next.plugin ?? []), 'file://./plugins/cavemem.js']));
    next.plugin = pluginList;
    writeJson(path, next);
    messages.push(`wrote ${path}`);

    // 2. Symlink the bridge plugin into the OpenCode plugins directory.
    const bridgeSource = join(dirname(ctx.cliPath), 'opencodeBridge.js');
    const pluginsDir = pluginDir(ctx);
    const link = pluginLink(ctx);
    mkdirSync(pluginsDir, { recursive: true });

    if (existsSync(link)) {
      // Remove stale symlink (points to an old cavemem install).
      unlinkSync(link);
    }
    symlinkSync(bridgeSource, link);
    messages.push(`symlinked bridge plugin ${link} -> ${bridgeSource}`);

    // 3. Clean up legacy config if it still has a stale mcpServers entry.
    const legacyFile = legacyConfigFile(ctx);
    if (existsSync(legacyFile)) {
      try {
        const legacy = JSON.parse(readFileSync(legacyFile, 'utf8')) as {
          mcpServers?: Record<string, unknown>;
        };
        if (legacy.mcpServers?.cavemem) {
          delete legacy.mcpServers.cavemem;
          writeFileSync(legacyFile, `${JSON.stringify(legacy, null, 2)}\n`, 'utf8');
          messages.push(`removed stale legacy MCP entry from ${legacyFile}`);
        }
      } catch {
        // Ignore parse errors in legacy config — not our file anymore.
      }
    }

    return messages;
  },
  async uninstall(ctx: InstallContext): Promise<string[]> {
    const messages: string[] = [];

    // 1. Remove MCP config and plugin entry from modern path.
    const cfgPath = configFile(ctx);
    const legacyFile = legacyConfigFile(ctx);

    for (const path of [cfgPath, legacyFile]) {
      if (!existsSync(path)) continue;
      const current = readJson<OpenCodeConfig>(path, {});
      if (current.mcp) {
        delete current.mcp.cavemem;
        if (Object.keys(current.mcp).length === 0) delete current.mcp;
      }
      if (current.mcpServers) {
        delete current.mcpServers.cavemem;
        if (Object.keys(current.mcpServers).length === 0) delete current.mcpServers;
      }
      if (current.plugin) {
        current.plugin = current.plugin.filter((p) => !p.includes('cavemem'));
        if (current.plugin.length === 0) delete current.plugin;
      }
      writeJson(path, current);
      messages.push(`updated ${path}`);
    }

    // 2. Remove bridge plugin symlink.
    const link = pluginLink(ctx);
    if (existsSync(link)) {
      unlinkSync(link);
      messages.push(`removed plugin symlink ${link}`);
    }

    return messages;
  },
};
