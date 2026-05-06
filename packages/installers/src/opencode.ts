import { existsSync, mkdirSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
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
}

function configFile(): string {
  return join(homedir(), '.config', 'opencode', 'opencode.json');
}

function pluginDir(): string {
  return join(homedir(), '.config', 'opencode', 'plugins');
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
    return (
      existsSync(join(homedir(), '.config', 'opencode')) ||
      existsSync(join(homedir(), '.opencode'))
    );
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
    writeJson(path, next);
    messages.push(`wrote ${path}`);

    // 2. Symlink the bridge plugin into the OpenCode plugins directory.
    const bridgeSource = join(dirname(ctx.cliPath), 'opencode-bridge.js');
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
          writeFileSync(
            legacyFile,
            `${JSON.stringify(legacy, null, 2)}\n`,
            'utf8',
          );
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

    // 1. Remove MCP config from modern path.
    const path = configFile();
    if (existsSync(path)) {
      const current = readJson<OpenCodeConfig>(path, {});
      if (current.mcp) {
        delete current.mcp.cavemem;
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

    // 3. Clean up legacy config too.
    const legacyUninstallFile = legacyConfigFile();
    if (existsSync(legacyUninstallFile)) {
      try {
        const legacy = JSON.parse(readFileSync(legacyUninstallFile, 'utf8')) as {
          mcpServers?: Record<string, unknown>;
        };
        if (legacy.mcpServers?.cavemem) {
          delete legacy.mcpServers.cavemem;
          writeFileSync(
            legacyUninstallFile,
            `${JSON.stringify(legacy, null, 2)}\n`,
            'utf8',
          );
          messages.push(`updated ${legacyUninstallFile}`);
        }
      } catch {
        // Ignore parse errors.
      }
    }

    return messages;
  },
};
