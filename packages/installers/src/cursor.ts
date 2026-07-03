import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { deepMerge, readJson, writeJson } from './fs-utils.js';
import type { InstallContext, Installer } from './types.js';

interface CursorConfig {
  mcpServers?: Record<string, { command: string; args?: string[] }>;
}

function configFile(ctx: InstallContext): string {
  return join(ctx.ideConfigDir, '.cursor', 'mcp.json');
}

export const cursor: Installer = {
  id: 'cursor',
  label: 'Cursor',
  capture: 'none',
  captureNotes: 'no hooks system — MCP query only',
  async detect(ctx: InstallContext): Promise<boolean> {
    return existsSync(join(ctx.ideConfigDir, '.cursor'));
  },
  async install(ctx: InstallContext): Promise<string[]> {
    const path = configFile(ctx);
    const current = readJson<CursorConfig>(path, {});
    const next = deepMerge<CursorConfig>(current, {
      mcpServers: { cavemem: { command: ctx.nodeBin, args: [ctx.cliPath, 'mcp'] } },
    });
    writeJson(path, next);
    return [`wrote ${path}`];
  },
  async uninstall(ctx: InstallContext): Promise<string[]> {
    const path = configFile(ctx);
    const current = readJson<CursorConfig>(path, {});
    if (current.mcpServers) delete current.mcpServers.cavemem;
    writeJson(path, current);
    return [`updated ${path}`];
  },
};
