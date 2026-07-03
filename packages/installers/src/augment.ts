import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deepMerge, readJson, writeJson } from './fs-utils.js';
import type { InstallContext, Installer } from './types.js';

interface AugmentHookCommand {
  type: string;
  command: string;
  timeout?: number;
  metadata?: Record<string, unknown>;
}

interface AugmentHookGroup {
  matcher?: string;
  hooks: AugmentHookCommand[];
}

interface AugmentSettings {
  hooks?: Record<string, AugmentHookGroup[]>;
  mcpServers?: Record<string, { command: string; args?: string[]; env?: Record<string, string> }>;
}

// Augment has no UserPromptSubmit event. Tool events require a matcher;
// session events reject one.
const HOOK_NAMES: Array<[string, string, { matcher?: boolean; conversationData?: boolean }]> = [
  ['SessionStart', 'session-start', {}],
  ['PostToolUse', 'post-tool-use', { matcher: true }],
  // Stop payloads carry no assistant text unless includeConversationData is
  // set — without it the turn-summary capture would silently store nothing.
  ['Stop', 'stop', { conversationData: true }],
  ['SessionEnd', 'session-end', {}],
];

function augmentDir(ctx: InstallContext): string {
  return join(ctx.ideConfigDir, '.augment');
}

function settingsFile(ctx: InstallContext): string {
  return join(augmentDir(ctx), 'settings.json');
}

// Augment's hook `command` must be a path to a script file (.sh/.cmd/…) — it
// rejects inline command strings — so we write thin wrappers that exec the CLI.
function wrapperDir(ctx: InstallContext): string {
  return join(augmentDir(ctx), 'cavemem-hooks');
}

function wrapperPath(ctx: InstallContext, hookId: string): string {
  const ext = process.platform === 'win32' ? 'cmd' : 'sh';
  return join(wrapperDir(ctx), `${hookId}.${ext}`);
}

function writeWrapper(ctx: InstallContext, hookId: string): string {
  const file = wrapperPath(ctx, hookId);
  mkdirSync(wrapperDir(ctx), { recursive: true });
  if (process.platform === 'win32') {
    writeFileSync(
      file,
      `@echo off\r\n"${ctx.nodeBin}" "${ctx.cliPath}" hook run ${hookId} --ide augment\r\n`,
      'utf8',
    );
  } else {
    writeFileSync(
      file,
      `#!/bin/sh\nexec "${ctx.nodeBin}" "${ctx.cliPath}" hook run ${hookId} --ide augment\n`,
      'utf8',
    );
    chmodSync(file, 0o755);
  }
  return file;
}

function isCavememGroup(ctx: InstallContext, group: AugmentHookGroup): boolean {
  const dir = wrapperDir(ctx);
  return group.hooks.some((h) => h.type === 'command' && h.command.startsWith(dir));
}

export const augment: Installer = {
  id: 'augment',
  label: 'Augment Code',
  capture: 'full',
  captureNotes: 'no UserPromptSubmit event',
  async detect(ctx: InstallContext): Promise<boolean> {
    return existsSync(augmentDir(ctx));
  },
  async install(ctx: InstallContext): Promise<string[]> {
    const messages: string[] = [];
    const path = settingsFile(ctx);

    for (const [, hookId] of HOOK_NAMES) {
      writeWrapper(ctx, hookId);
    }
    messages.push(`wrote hook wrappers to ${wrapperDir(ctx)}`);

    // Hooks and mcpServers live in the same settings.json — build the full
    // next state and write once.
    const settings = readJson<AugmentSettings>(path, {});
    const hooks: Record<string, AugmentHookGroup[]> = { ...(settings.hooks ?? {}) };
    for (const [eventName, hookId, opts] of HOOK_NAMES) {
      const others = (hooks[eventName] ?? []).filter((g) => !isCavememGroup(ctx, g));
      const command: AugmentHookCommand = { type: 'command', command: wrapperPath(ctx, hookId) };
      if (opts.conversationData) command.metadata = { includeConversationData: true };
      others.push({
        ...(opts.matcher ? { matcher: '.*' } : {}),
        hooks: [command],
      });
      hooks[eventName] = others;
    }

    const next = deepMerge<AugmentSettings>(settings, {
      mcpServers: {
        cavemem: { command: ctx.nodeBin, args: [ctx.cliPath, 'mcp'] },
      },
    });
    next.hooks = hooks;
    writeJson(path, next);
    messages.push(`wrote ${path}`);

    return messages;
  },
  async uninstall(ctx: InstallContext): Promise<string[]> {
    const messages: string[] = [];
    const path = settingsFile(ctx);

    if (existsSync(path)) {
      const settings = readJson<AugmentSettings>(path, {});
      if (settings.hooks) {
        for (const [eventName] of HOOK_NAMES) {
          const arr = settings.hooks[eventName];
          if (!arr) continue;
          const remaining = arr.filter((g) => !isCavememGroup(ctx, g));
          if (remaining.length === 0) delete settings.hooks[eventName];
          else settings.hooks[eventName] = remaining;
        }
        if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
      }
      if (settings.mcpServers?.cavemem) {
        delete settings.mcpServers.cavemem;
        if (Object.keys(settings.mcpServers).length === 0) delete settings.mcpServers;
      }
      writeJson(path, settings);
      messages.push(`updated ${path}`);
    }

    const wrappers = wrapperDir(ctx);
    if (existsSync(wrappers)) {
      rmSync(wrappers, { recursive: true, force: true });
      messages.push(`removed ${wrappers}`);
    }

    return messages;
  },
};
