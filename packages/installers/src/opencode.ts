import {
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
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

function configRoot(): string {
  // Per OpenCode docs, the user-global config dir is ~/.config/opencode/.
  // We honor XDG_CONFIG_HOME if set.
  const xdg = process.env.XDG_CONFIG_HOME;
  return xdg ? join(xdg, 'opencode') : join(homedir(), '.config', 'opencode');
}

function configFile(): string {
  return join(configRoot(), 'opencode.json');
}

function pluginDir(): string {
  return join(configRoot(), 'plugins');
}

function pluginLink(): string {
  return join(pluginDir(), 'cavemem.js');
}

// Legacy config path used by earlier versions of the installer.
function legacyConfigFile(): string {
  return join(homedir(), '.opencode', 'config.json');
}

export const openCode: Installer = {
  id: 'opencode',
  label: 'OpenCode',
  async detect(_ctx): Promise<boolean> {
    // Prefer the modern XDG path; fall back to the legacy dot-dir.
    return existsSync(configRoot()) || existsSync(join(homedir(), '.opencode'));
  },
  async install(ctx: InstallContext): Promise<string[]> {
    const messages: string[] = [];

    // 1. Write MCP config to the correct OpenCode config file.
    const path = configFile();
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
    // Ensure the bundled bridge plugin is listed so OpenCode auto-loads it.
    // Plugins in plugins/ also auto-load, but listing in `plugin` makes intent
    // explicit and survives plugin-dir overrides.
    const pluginList = Array.from(new Set([...(next.plugin ?? []), 'file://./plugins/cavemem.js']));
    next.plugin = pluginList;
    writeJson(path, next);
    messages.push(`wrote ${path}`);

    // 2. Symlink the bridge plugin into the OpenCode plugins directory.
    const bridgeSource = join(dirname(ctx.cliPath), 'opencodeBridge.js');
    const pluginsDir = pluginDir();
    const link = pluginLink();
    mkdirSync(pluginsDir, { recursive: true });

    if (existsSync(link)) {
      // Remove stale symlink (points to an old cavemem install).
      unlinkSync(link);
    }
    symlinkSync(bridgeSource, link);
    messages.push(`symlinked bridge plugin ${link} -> ${bridgeSource}`);

    // 3. Clean up legacy config if it still has a stale mcpServers entry.
    const legacyFile = legacyConfigFile();
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
  async uninstall(_ctx): Promise<string[]> {
    const messages: string[] = [];

    // 1. Remove MCP config and plugin entry from modern path.
    const cfgPath = configFile();
    const legacyFile = legacyConfigFile();

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
    const link = pluginLink();
    if (existsSync(link)) {
      unlinkSync(link);
      messages.push(`removed plugin symlink ${link}`);
    }

    return messages;
  },
};
