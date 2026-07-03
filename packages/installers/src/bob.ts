import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { deepMerge, readJson, writeJson } from './fs-utils.js';
import type { InstallContext, Installer } from './types.js';

interface BobMcpConfig {
  mcpServers?: Record<string, { command: string; args?: string[]; env?: Record<string, string> }>;
}

function configFile(ctx: InstallContext): string {
  return join(ctx.ideConfigDir, '.bob', 'mcp.json');
}

export const bob: Installer = {
  id: 'bob',
  label: 'IBM Bob',
  capture: 'none',
  captureNotes: 'no hooks system — MCP query only',
  async detect(ctx: InstallContext): Promise<boolean> {
    return existsSync(join(ctx.ideConfigDir, '.bob'));
  },
  async install(ctx: InstallContext): Promise<string[]> {
    const path = configFile(ctx);
    const next = deepMerge<BobMcpConfig>(readJson<BobMcpConfig>(path, {}), {
      mcpServers: { cavemem: { command: ctx.nodeBin, args: [ctx.cliPath, 'mcp'] } },
    });
    writeJson(path, next);
    return [
      `wrote ${path}`,
      'WARNING: IBM Bob has no hooks system — cavemem is query-only here: memory captured in other IDEs is searchable via MCP, but Bob sessions will not capture new observations.',
    ];
  },
  async uninstall(ctx: InstallContext): Promise<string[]> {
    const path = configFile(ctx);
    if (!existsSync(path)) return [];
    const current = readJson<BobMcpConfig>(path, {});
    if (current.mcpServers) {
      delete current.mcpServers.cavemem;
      if (Object.keys(current.mcpServers).length === 0) delete current.mcpServers;
    }
    writeJson(path, current);
    return [`updated ${path}`];
  },
};
