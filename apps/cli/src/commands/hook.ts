import { type HookName, type HookResult, runHook } from '@cavemem/hooks';
import type { Command } from 'commander';

const VALID: HookName[] = [
  'session-start',
  'user-prompt-submit',
  'post-tool-use',
  'stop',
  'session-end',
];

// Claude Code event names — used in hookSpecificOutput.hookEventName when we
// emit additionalContext back to the agent.
const CLAUDE_EVENT_NAME: Record<HookName, string> = {
  'session-start': 'SessionStart',
  'user-prompt-submit': 'UserPromptSubmit',
  'post-tool-use': 'PostToolUse',
  stop: 'Stop',
  'session-end': 'SessionEnd',
};

export function registerHookCommand(program: Command): void {
  const hook = program.command('hook').description('Internal: hook handler entrypoints');
  hook
    .command('run <name>')
    .description('Run a hook by name (reads JSON from stdin)')
    .option('--ide <name>', 'IDE that invoked the hook (Claude Code does not send this)')
    .action(async (name: string, opts: { ide?: string }) => {
      if (!VALID.includes(name as HookName)) {
        // Stay non-blocking: the IDE's hook config could be stale.
        process.stderr.write(`${JSON.stringify({ ok: false, error: `unknown hook ${name}` })}\n`);
        process.exitCode = 1;
        return;
      }
      const hookName = name as HookName;
      const raw = await readStdin();
      const parsed = normalizeForIde(opts.ide, raw.trim() ? safeJson(raw) : {});
      const input = {
        session_id: typeof parsed.session_id === 'string' ? parsed.session_id : 'unknown',
        ...parsed,
        ...(opts.ide ? { ide: opts.ide } : {}),
      } as Parameters<typeof runHook>[1];

      const result = await runHook(hookName, input);

      // Telemetry always goes to stderr — stdout is reserved for the IDE's
      // hook protocol and any text we put there is interpreted (e.g. injected
      // as additionalContext).
      process.stderr.write(`${JSON.stringify({ hook: hookName, ...result })}\n`);

      if (!result.ok) {
        // Non-blocking error: stderr already carries the structured payload;
        // exit 1 surfaces it in the IDE's hook log without blocking the turn.
        process.exitCode = 1;
        return;
      }

      writeIdeOutput(hookName, result);
    });
}

function writeIdeOutput(hook: HookName, result: HookResult): void {
  // Only SessionStart and UserPromptSubmit can usefully feed text back into
  // the agent. For other hooks we deliberately stay silent on stdout.
  if (hook !== 'session-start' && hook !== 'user-prompt-submit') return;
  const ctx = result.context?.trim();
  if (!ctx) return;
  const payload = {
    hookSpecificOutput: {
      hookEventName: CLAUDE_EVENT_NAME[hook],
      additionalContext: ctx,
    },
  };
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

// Augment's hook payloads use different field names than Claude Code's
// (conversation_id, workspace_roots, and assistant text nested under
// `conversation` — present only when the installer sets
// metadata.includeConversationData on the Stop hook). Translate them here so
// packages/hooks stays IDE-agnostic. Exported for tests.
export function normalizeForIde(
  ide: string | undefined,
  parsed: Record<string, unknown>,
): Record<string, unknown> {
  if (ide !== 'augment') return parsed;
  const out = { ...parsed };
  if (typeof out.session_id !== 'string' && typeof out.conversation_id === 'string') {
    out.session_id = out.conversation_id;
  }
  if (
    out.cwd === undefined &&
    Array.isArray(out.workspace_roots) &&
    typeof out.workspace_roots[0] === 'string'
  ) {
    out.cwd = out.workspace_roots[0];
  }
  const conversation = out.conversation as Record<string, unknown> | undefined;
  if (
    out.turn_summary === undefined &&
    conversation &&
    typeof conversation.agentTextResponse === 'string'
  ) {
    out.turn_summary = conversation.agentTextResponse;
  }
  return out;
}

function safeJson(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s);
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) {
      resolve('');
      return;
    }
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
  });
}
