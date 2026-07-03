import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { deepMerge, readJson, writeJson } from './fs-utils.js';
import type { InstallContext, Installer } from './types.js';

interface AntigravityMcpConfig {
  mcpServers?: Record<string, { command: string; args?: string[]; env?: Record<string, string> }>;
}

function configFile(ctx: InstallContext): string {
  return join(ctx.ideConfigDir, '.gemini', 'config', 'mcp_config.json');
}

export const antigravity: Installer = {
  id: 'antigravity',
  label: 'Antigravity',
  async detect(ctx: InstallContext): Promise<boolean> {
    return existsSync(join(ctx.ideConfigDir, '.gemini', 'config'));
  },
  async install(ctx: InstallContext): Promise<string[]> {
    const path = configFile(ctx);
    const next = deepMerge<AntigravityMcpConfig>(readJson<AntigravityMcpConfig>(path, {}), {
      mcpServers: { cavemem: { command: ctx.nodeBin, args: [ctx.cliPath, 'mcp'] } },
    });
    writeJson(path, next);
    return [
      `wrote ${path}`,
      'WARNING: Antigravity has no hooks system — cavemem is query-only here: memory captured in other IDEs is searchable via MCP, but Antigravity sessions will not capture new observations.',
    ];
  },
  async uninstall(ctx: InstallContext): Promise<string[]> {
    const path = configFile(ctx);
    const current = readJson<AntigravityMcpConfig>(path, {});
    if (current.mcpServers) delete current.mcpServers.cavemem;
    writeJson(path, current);
    return [`updated ${path}`];
  },
};
