import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { deepMerge, readJson, writeJson } from './fs-utils.js';
import type { InstallContext, Installer } from './types.js';

interface CursorConfig {
  mcpServers?: Record<string, { command: string; args?: string[] }>;
}

function configFile(): string {
  return join(homedir(), '.cursor', 'mcp.json');
}

export const cursor: Installer = {
  id: 'cursor',
  label: 'Cursor',
  async detect(_ctx): Promise<boolean> {
    return existsSync(join(homedir(), '.cursor'));
  },
  async install(ctx: InstallContext): Promise<string[]> {
    const path = configFile();
    const current = readJson<CursorConfig>(path, {});
    const next = deepMerge<CursorConfig>(current, {
      mcpServers: { cavemem: { command: ctx.cliPath, args: ['mcp'] } },
    });
    writeJson(path, next);
    return [`wrote ${path}`];
  },
  async uninstall(_ctx): Promise<string[]> {
    const path = configFile();
    const current = readJson<CursorConfig>(path, {});
    if (current.mcpServers) delete current.mcpServers.cavemem;
    writeJson(path, current);
    return [`updated ${path}`];
  },
};
