import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { deepMerge, readJson, shellQuote, writeJson } from './fs-utils.js';
import type { InstallContext, Installer } from './types.js';

interface CopilotHookEntry {
  type: string;
  command: string;
  timeout?: number;
}

interface CopilotHooksFile {
  hooks?: Record<string, CopilotHookEntry[]>;
}

interface VsCodeMcpJson {
  servers?: Record<
    string,
    { type?: string; command: string; args?: string[]; env?: Record<string, string> }
  >;
}

// Copilot's hook payloads are deliberately Claude-Code-compatible (session_id,
// cwd, hook_event_name, tool_name/tool_input/tool_response…), so the existing
// handlers read them without translation. Copilot has no SessionEnd event.
const HOOK_NAMES: Array<[string, string]> = [
  ['SessionStart', 'session-start'],
  ['UserPromptSubmit', 'user-prompt-submit'],
  ['PostToolUse', 'post-tool-use'],
  ['Stop', 'stop'],
];

// ~/.copilot/hooks/ is a directory of independent *.json files that all get
// loaded, so cavemem owns a dedicated file instead of merging into a shared one.
function hooksFile(ctx: InstallContext): string {
  return join(ctx.ideConfigDir, '.copilot', 'hooks', 'cavemem.json');
}

// VS Code's user-level mcp.json lives in the platform-specific user profile
// dir, not under $HOME directly. Bases stay overridable (ideConfigDir / env)
// so tests can inject temp dirs.
function vscodeUserDir(ctx: InstallContext): string {
  if (process.platform === 'darwin') {
    return join(ctx.ideConfigDir, 'Library', 'Application Support', 'Code', 'User');
  }
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA ?? join(ctx.ideConfigDir, 'AppData', 'Roaming');
    return join(appData, 'Code', 'User');
  }
  const xdg = process.env.XDG_CONFIG_HOME ?? join(ctx.ideConfigDir, '.config');
  return join(xdg, 'Code', 'User');
}

function mcpFile(ctx: InstallContext): string {
  return join(vscodeUserDir(ctx), 'mcp.json');
}

function isCavememHook(entry: CopilotHookEntry, hookId: string): boolean {
  return entry.type === 'command' && entry.command.includes(`hook run ${hookId}`);
}

export const copilot: Installer = {
  id: 'copilot',
  label: 'GitHub Copilot',
  async detect(ctx: InstallContext): Promise<boolean> {
    return existsSync(join(ctx.ideConfigDir, '.copilot'));
  },
  async install(ctx: InstallContext): Promise<string[]> {
    const messages: string[] = [];
    const nodeBin = shellQuote(ctx.nodeBin);
    const cliPath = shellQuote(ctx.cliPath);

    // ---- hooks → ~/.copilot/hooks/cavemem.json ----
    const hooksPath = hooksFile(ctx);
    const current = readJson<CopilotHooksFile>(hooksPath, {});
    const hooks: Record<string, CopilotHookEntry[]> = { ...(current.hooks ?? {}) };
    for (const [eventName, hookId] of HOOK_NAMES) {
      // Filter prior cavemem entries (idempotent re-install); a user may have
      // hand-added other entries to this file, keep those verbatim.
      const others = (hooks[eventName] ?? []).filter((e) => !isCavememHook(e, hookId));
      others.push({
        type: 'command',
        command: `${nodeBin} ${cliPath} hook run ${hookId} --ide copilot`,
      });
      hooks[eventName] = others;
    }
    writeJson(hooksPath, { ...current, hooks });
    messages.push(`wrote ${hooksPath}`);

    // ---- MCP → VS Code user mcp.json: root key is `servers`, not
    // `mcpServers`, and stdio entries need an explicit type. ----
    const mcpPath = mcpFile(ctx);
    const mcpNext = deepMerge<VsCodeMcpJson>(readJson<VsCodeMcpJson>(mcpPath, {}), {
      servers: {
        cavemem: { type: 'stdio', command: ctx.nodeBin, args: [ctx.cliPath, 'mcp'] },
      },
    });
    writeJson(mcpPath, mcpNext);
    messages.push(`wrote ${mcpPath}`);

    return messages;
  },
  async uninstall(ctx: InstallContext): Promise<string[]> {
    const messages: string[] = [];

    const hooksPath = hooksFile(ctx);
    if (existsSync(hooksPath)) {
      const current = readJson<CopilotHooksFile>(hooksPath, {});
      const hooks = current.hooks ?? {};
      for (const [eventName, hookId] of HOOK_NAMES) {
        const arr = hooks[eventName];
        if (!arr) continue;
        const remaining = arr.filter((e) => !isCavememHook(e, hookId));
        if (remaining.length === 0) delete hooks[eventName];
        else hooks[eventName] = remaining;
      }
      if (Object.keys(hooks).length === 0) {
        // The file is cavemem-owned; once our entries are gone, remove it so
        // Copilot doesn't keep loading an empty hooks file.
        unlinkSync(hooksPath);
        messages.push(`removed ${hooksPath}`);
      } else {
        writeJson(hooksPath, { ...current, hooks });
        messages.push(`updated ${hooksPath}`);
      }
    }

    const mcpPath = mcpFile(ctx);
    if (existsSync(mcpPath)) {
      const current = readJson<VsCodeMcpJson>(mcpPath, {});
      if (current.servers?.cavemem) {
        delete current.servers.cavemem;
        if (Object.keys(current.servers).length === 0) delete current.servers;
      }
      writeJson(mcpPath, current);
      messages.push(`updated ${mcpPath}`);
    }

    return messages;
  },
};
