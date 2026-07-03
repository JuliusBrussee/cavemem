import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { deepMerge, readJson, writeJson } from './fs-utils.js';
import type { InstallContext, Installer } from './types.js';

interface GeminiSettings {
  mcpServers?: Record<string, { command: string; args?: string[] }>;
  contextFiles?: string[];
}

function settingsFile(ctx: InstallContext): string {
  return join(ctx.ideConfigDir, '.gemini', 'settings.json');
}

export const geminiCli: Installer = {
  id: 'gemini-cli',
  label: 'Gemini CLI',
  async detect(ctx: InstallContext): Promise<boolean> {
    return existsSync(join(ctx.ideConfigDir, '.gemini'));
  },
  async install(ctx: InstallContext): Promise<string[]> {
    const path = settingsFile(ctx);
    const current = readJson<GeminiSettings>(path, {});
    const next = deepMerge<GeminiSettings>(current, {
      mcpServers: {
        cavemem: { command: ctx.nodeBin, args: [ctx.cliPath, 'mcp'] },
      },
    });
    writeJson(path, next);
    return [`wrote ${path}`];
  },
  async uninstall(ctx: InstallContext): Promise<string[]> {
    const path = settingsFile(ctx);

    const current = readJson<GeminiSettings>(path, {});
    if (current.mcpServers) delete current.mcpServers.cavemem;
    writeJson(path, current);
    return [`updated ${path}`];
  },
};
