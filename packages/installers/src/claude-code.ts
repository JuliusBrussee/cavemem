import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { deepMerge, readJson, writeJson } from './fs-utils.js';
import type { InstallContext, Installer } from './types.js';

interface ClaudeSettings {
  hooks?: Record<
    string,
    Array<{ matcher?: string; hooks: Array<{ type: string; command: string }> }>
  >;
  mcpServers?: Record<string, { command: string; args?: string[]; env?: Record<string, string> }>;
}

const HOOK_NAMES: Array<[string, string]> = [
  ['SessionStart', 'session-start'],
  ['UserPromptSubmit', 'user-prompt-submit'],
  ['PostToolUse', 'post-tool-use'],
  ['Stop', 'stop'],
  ['SessionEnd', 'session-end'],
];

function settingsFile(): string {
  return join(homedir(), '.claude', 'settings.json');
}

export const claudeCode: Installer = {
  id: 'claude-code',
  label: 'Claude Code',
  async detect(_ctx: InstallContext): Promise<boolean> {
    return existsSync(join(homedir(), '.claude'));
  },
  async install(ctx: InstallContext): Promise<string[]> {
    const path = settingsFile();
    const current = readJson<ClaudeSettings>(path, {});
    const hooks: ClaudeSettings['hooks'] = { ...(current.hooks ?? {}) };
    for (const [claudeName, hookId] of HOOK_NAMES) {
      hooks[claudeName] = [
        {
          hooks: [
            {
              type: 'command',
              command: `${ctx.cliPath} hook run ${hookId}`,
            },
          ],
        },
      ];
    }
    const mcpServers = {
      ...(current.mcpServers ?? {}),
      cavemem: {
        command: ctx.cliPath,
        args: ['mcp'],
      },
    };
    const next = deepMerge<ClaudeSettings>(current, { hooks, mcpServers });
    writeJson(path, next);
    return [`wrote ${path}`];
  },
  async uninstall(_ctx: InstallContext): Promise<string[]> {
    const path = settingsFile();
    const current = readJson<ClaudeSettings>(path, {});
    if (current.hooks) {
      for (const [claudeName] of HOOK_NAMES) delete current.hooks[claudeName];
    }
    if (current.mcpServers) delete current.mcpServers.cavemem;
    writeJson(path, current);
    return [`updated ${path}`];
  },
};
