import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { deepMerge, readJson, writeJson } from './fs-utils.js';
import type { InstallContext, Installer } from './types.js';

interface GeminiSettings {
  mcpServers?: Record<string, { command: string; args?: string[] }>;
  contextFiles?: string[];
}

function settingsFile(): string {
  return join(homedir(), '.gemini', 'settings.json');
}

export const geminiCli: Installer = {
  id: 'gemini-cli',
  label: 'Gemini CLI',
  async detect(_ctx): Promise<boolean> {
    return existsSync(join(homedir(), '.gemini'));
  },
  async install(ctx: InstallContext): Promise<string[]> {
    const path = settingsFile();
    const current = readJson<GeminiSettings>(path, {});
    const next = deepMerge<GeminiSettings>(current, {
      mcpServers: {
        cavemem: { command: ctx.cliPath, args: ['mcp'] },
      },
    });
    writeJson(path, next);
    return [`wrote ${path}`];
  },
  async uninstall(_ctx): Promise<string[]> {
    const path = settingsFile();
    const current = readJson<GeminiSettings>(path, {});
    if (current.mcpServers) delete current.mcpServers.cavemem;
    writeJson(path, current);
    return [`updated ${path}`];
  },
};
