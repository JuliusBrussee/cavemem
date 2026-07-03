import { copyFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { deepMerge, readJson, shellQuote, writeJson } from './fs-utils.js';
import type { InstallContext, Installer } from './types.js';

interface ClaudeHookEntry {
  matcher?: string;
  hooks: Array<{ type: string; command: string }>;
}

interface ClaudeSettings {
  hooks?: Record<string, ClaudeHookEntry[]>;
  // Older versions of this installer wrote mcpServers here. Newer Claude Code
  // reads MCP config from ~/.claude.json instead, so we migrate it out.
  mcpServers?: Record<string, { command: string; args?: string[]; env?: Record<string, string> }>;
}

interface ClaudeJson {
  mcpServers?: Record<string, { command: string; args?: string[]; env?: Record<string, string> }>;
}

const HOOK_NAMES: Array<[string, string]> = [
  ['SessionStart', 'session-start'],
  ['UserPromptSubmit', 'user-prompt-submit'],
  ['PostToolUse', 'post-tool-use'],
  ['Stop', 'stop'],
  ['SessionEnd', 'session-end'],
];

function settingsFile(ctx: InstallContext): string {
  return join(ctx.ideConfigDir, '.claude', 'settings.json');
}

function mcpFile(ctx: InstallContext): string {
  return join(ctx.ideConfigDir, '.claude.json');
}

function isCavememHookEntry(entry: ClaudeHookEntry, hookId: string): boolean {
  return entry.hooks.some((h) => h.type === 'command' && h.command.includes(`hook run ${hookId}`));
}

export const claudeCode: Installer = {
  id: 'claude-code',
  label: 'Claude Code',
  async detect(ctx: InstallContext): Promise<boolean> {
    return existsSync(join(ctx.ideConfigDir, '.claude'));
  },
  async install(ctx: InstallContext): Promise<string[]> {
    const messages: string[] = [];
    const settingsPath = settingsFile(ctx);
    const mcpPath = mcpFile(ctx);
    // Hook commands are shell strings, so nodeBin + cliPath must be quoted —
    // Windows npm installs land under paths like C:\Users\...\AppData that
    // may contain spaces. Both cmd.exe and sh treat "..." as one argv token.
    const nodeBin = shellQuote(ctx.nodeBin);
    const cliPath = shellQuote(ctx.cliPath);

    // ---- hooks → ~/.claude/settings.json: append to existing arrays ----
    const settings = readJson<ClaudeSettings>(settingsPath, {});
    const hooks: Record<string, ClaudeHookEntry[]> = { ...(settings.hooks ?? {}) };
    let preservedNonCavemem = false;

    for (const [claudeName, hookId] of HOOK_NAMES) {
      const existing = hooks[claudeName] ?? [];
      // Strip prior cavemem entries (idempotent re-install) but keep
      // everything else verbatim.
      const others = existing.filter((entry) => !isCavememHookEntry(entry, hookId));
      if (others.length > 0) preservedNonCavemem = true;
      others.push({
        hooks: [
          {
            type: 'command',
            command: `${nodeBin} ${cliPath} hook run ${hookId} --ide claude-code`,
          },
        ],
      });
      hooks[claudeName] = others;
    }

    if (preservedNonCavemem && existsSync(settingsPath)) {
      const backup = `${settingsPath}.pre-cavemem-${Date.now()}`;
      copyFileSync(settingsPath, backup);
      messages.push(`backed up existing hooks to ${backup}`);
    }

    const settingsNext: ClaudeSettings = { ...settings, hooks };
    // Migration: an older installer wrote mcpServers.cavemem here. Move it
    // out so Claude Code (which now reads MCP from ~/.claude.json) picks it up.
    if (settingsNext.mcpServers?.cavemem) {
      const { cavemem: _legacy, ...rest } = settingsNext.mcpServers;
      if (Object.keys(rest).length === 0) delete settingsNext.mcpServers;
      else settingsNext.mcpServers = rest;
    }
    writeJson(settingsPath, settingsNext);
    messages.push(`wrote ${settingsPath}`);

    // ---- mcpServers → ~/.claude.json: deep-merge to preserve user keys ----
    const claudeJson = readJson<ClaudeJson>(mcpPath, {});
    const mcpNext = deepMerge<ClaudeJson>(claudeJson, {
      mcpServers: {
        // Spawn node explicitly — if command is the .js file, Claude Code's
        // MCP launcher can't exec it on Windows (EFTYPE).
        cavemem: { command: ctx.nodeBin, args: [ctx.cliPath, 'mcp'] },
      },
    });
    writeJson(mcpPath, mcpNext);
    messages.push(`wrote ${mcpPath}`);

    return messages;
  },
  async uninstall(ctx: InstallContext): Promise<string[]> {
    const messages: string[] = [];
    const settingsPath = settingsFile(ctx);
    const mcpPath = mcpFile(ctx);

    if (existsSync(settingsPath)) {
      const settings = readJson<ClaudeSettings>(settingsPath, {});
      if (settings.hooks) {
        for (const [claudeName, hookId] of HOOK_NAMES) {
          const arr = settings.hooks[claudeName];
          if (!arr) continue;
          const remaining = arr.filter((entry) => !isCavememHookEntry(entry, hookId));
          if (remaining.length === 0) delete settings.hooks[claudeName];
          else settings.hooks[claudeName] = remaining;
        }
      }
      if (settings.mcpServers?.cavemem) {
        delete settings.mcpServers.cavemem;
        if (Object.keys(settings.mcpServers).length === 0) delete settings.mcpServers;
      }
      writeJson(settingsPath, settings);
      messages.push(`updated ${settingsPath}`);
    }

    if (existsSync(mcpPath)) {
      const claudeJson = readJson<ClaudeJson>(mcpPath, {});
      if (claudeJson.mcpServers?.cavemem) {
        delete claudeJson.mcpServers.cavemem;
        if (Object.keys(claudeJson.mcpServers).length === 0) delete claudeJson.mcpServers;
      }
      writeJson(mcpPath, claudeJson);
      messages.push(`updated ${mcpPath}`);
    }

    return messages;
  },
};
