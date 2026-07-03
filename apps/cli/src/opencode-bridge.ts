import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expand } from '@cavemem/compress';
import { loadSettings, resolveDataDir } from '@cavemem/config';
import { MemoryStore } from '@cavemem/core';

/* ------------------------------------------------------------------ */
// Minimal local types for the OpenCode plugin API (no runtime dependency
// on @opencode-ai/plugin — the bridge is loaded dynamically by OpenCode).
/* ------------------------------------------------------------------ */

type BunShell = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<unknown> & { text(): Promise<string> };

interface PluginInput {
  $: BunShell;
  directory: string;
}

interface OpenCodeEvent {
  type: string;
  properties?: Record<string, unknown>;
}

interface Hooks {
  event?: (input: { event: OpenCodeEvent }) => Promise<void>;
  'tool.execute.after'?: (
    input: { sessionID: string; tool: string; args: unknown },
    output: { output: unknown },
  ) => Promise<void>;
  'experimental.chat.system.transform'?: (
    input: { sessionID?: string; model: unknown },
    output: { system: string[] },
  ) => Promise<void>;
}

/* ------------------------------------------------------------------ */
// Cavemem binary discovery
/* ------------------------------------------------------------------ */

function resolveCavememCli(): string {
  // Strategy 1: we're bundled alongside the CLI entrypoint (same dist/ dir).
  const bridgePath = fileURLToPath(import.meta.url);
  const bridgeDir = dirname(bridgePath);
  const sibling = join(bridgeDir, 'index.js');
  if (existsSync(sibling)) return sibling;

  // Strategy 2: global npm binary.
  try {
    const result = execFileSync('which', ['cavemem'], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim();
    if (result) return result;
  } catch {}

  // Strategy 3: derive from npm global root.
  try {
    const globalRoot = execFileSync('npm', ['root', '-g'], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim();
    const fromNpm = join(globalRoot, 'cavemem', 'dist', 'index.js');
    if (existsSync(fromNpm)) return fromNpm;
  } catch {}

  return 'cavemem';
}

/* ------------------------------------------------------------------ */
// Helpers
/* ------------------------------------------------------------------ */

function truncate(value: unknown, max = 2000): string {
  if (value == null) return '';
  const str = typeof value === 'string' ? value : JSON.stringify(value);
  return str.length > max ? `${str.slice(0, max)}…` : str;
}

const LOG_PATH = '/tmp/cavemem-bridge-errors.log';

function log(msg: string): void {
  try {
    // Plain fs append — no subprocess, so this can never itself block the
    // IDE waiting on a shell round-trip.
    appendFileSync(LOG_PATH, `[cavemem-bridge] ${msg}\n`);
  } catch {
    // Silent — logging must never break the main flow.
  }
}

/* ------------------------------------------------------------------ */
// Plugin
/* ------------------------------------------------------------------ */

export default async function cavememBridge({ directory }: PluginInput): Promise<Hooks> {
  const CAVEMEM = resolveCavememCli();

  // Track which sessions we have already started so we don't duplicate.
  const activeSessions = new Set<string>();
  // Track which sessions already received retrieved context.
  const queriedSessions = new Set<string>();
  // Accumulate assistant message text by message ID.
  const messageTexts = new Map<string, { sessionID: string; text: string }>();
  // Track which message IDs are user messages (for prompt capture).
  const userMessageIds = new Set<string>();

  // Load settings and open the store once for read-only context retrieval.
  // The store is used only for prior-session priming; all writes go through
  // the cavemem CLI hook commands so they follow the compression + redaction
  // pipeline enforced by MemoryStore.
  let store: MemoryStore | undefined;
  try {
    const settings = loadSettings();
    const dbPath = join(resolveDataDir(settings.dataDir), 'data.db');
    store = new MemoryStore({ dbPath, settings });
  } catch {
    // If settings or DB are missing, prior-session context is simply skipped.
  }

  async function runHook(name: string, data: Record<string, unknown>): Promise<void> {
    // Fire-and-forget: detached + unref so the IDE never waits on the CLI
    // subprocess (compression, SQLite insert, worker auto-spawn probe). Never
    // await the child's exit here — that would block every hook-triggering
    // event on a full `cavemem hook run` round-trip.
    try {
      const child = spawn(CAVEMEM, ['hook', 'run', name, '--ide', 'opencode'], {
        stdio: ['pipe', 'ignore', 'ignore'],
        detached: true,
      });
      child.on('error', (err) => log(`hook ${name} spawn failed: ${(err as Error).message}`));
      child.stdin.on('error', () => {});
      child.stdin.end(JSON.stringify(data));
      child.unref();
    } catch (err) {
      const msg = (err as Error)?.message || String(err);
      log(`hook ${name} failed: ${msg.slice(0, 200)}`);
    }
  }

  async function flushTurn(sessionID: string, messageID: string): Promise<void> {
    const entry = messageTexts.get(messageID);
    if (!entry) return;
    const text = entry.text.trim();
    messageTexts.delete(messageID);
    if (!text) return;
    await runHook('stop', {
      session_id: sessionID,
      turn_summary: text,
    });
  }

  async function getRecentContext(sessionID: string): Promise<string> {
    if (!sessionID) return '';
    if (queriedSessions.has(sessionID)) return '';
    queriedSessions.add(sessionID);

    if (!store) return '';

    try {
      const sessions = store.storage.listSessions(50);
      // Scope to the current project directory — otherwise opening OpenCode
      // in project A can inject summaries from an unrelated project B
      // session (privacy + relevance bug; see the same fix applied to the
      // Claude Code session-start handler in #39). Falls back to unscoped
      // behaviour only if we somehow have no directory to compare against.
      const ended = sessions
        .filter(
          (s) => s.id !== sessionID && s.ended_at !== null && (!directory || s.cwd === directory),
        )
        .sort((a, b) => b.started_at - a.started_at)
        .slice(0, 3);

      const hints: string[] = [];
      for (const session of ended) {
        const summaries = store.storage.listSummaries(session.id);
        const sessionSummary = summaries.find((s) => s.scope === 'session');
        if (!sessionSummary) continue;

        const raw = sessionSummary.content;
        const text = sessionSummary.compressed === 1 ? expand(raw) : raw;
        if (text.trim()) hints.push(text.trim());
      }

      log(`retrieval for ${sessionID}: ${hints.length} summaries found`);
      if (hints.length === 0) return '';

      const context = `Prior context (internal): ${hints.join(' | ')}`;
      log(`injected ${context.length} chars`);
      return context;
    } catch (err) {
      const msg = (err as Error)?.message || String(err);
      log(`retrieval error: ${msg}`);
      return '';
    }
  }

  return {
    event: async ({ event }) => {
      try {
        if (!event) return;

        switch (event.type) {
          case 'session.created': {
            const session = event.properties?.info as
              | { id: string; directory?: string }
              | undefined;
            if (!session) return;
            if (activeSessions.has(session.id)) return;
            activeSessions.add(session.id);
            await runHook('session-start', {
              session_id: session.id,
              ide: 'opencode',
              cwd: session.directory || directory,
            });
            break;
          }

          case 'session.idle': {
            const sid = event.properties?.sessionID as string | undefined;
            if (!sid) return;
            for (const [mid, entry] of messageTexts) {
              if (entry.sessionID === sid) await flushTurn(sid, mid);
            }
            activeSessions.delete(sid);
            queriedSessions.delete(sid);
            await runHook('session-end', { session_id: sid });
            break;
          }

          case 'session.deleted': {
            const session = event.properties?.info as { id: string } | undefined;
            if (!session) return;
            for (const [mid, entry] of messageTexts) {
              if (entry.sessionID === session.id) await flushTurn(session.id, mid);
            }
            activeSessions.delete(session.id);
            queriedSessions.delete(session.id);
            await runHook('session-end', {
              session_id: session.id,
            });
            break;
          }

          case 'command.executed': {
            const props = event.properties as
              | { sessionID?: string; name?: string; arguments?: unknown }
              | undefined;
            if (!props) return;
            await runHook('post-tool-use', {
              session_id: props.sessionID,
              tool_name: `cmd:${props.name}`,
              tool_input: truncate(props.arguments, 500),
              tool_response: '',
            });
            break;
          }

          case 'message.part.updated': {
            const props = event.properties as
              | {
                  part?: {
                    type: string;
                    sessionID?: string;
                    messageID?: string;
                    text?: string;
                  };
                  delta?: string;
                }
              | undefined;
            if (!props) return;
            const part = props.part;
            if (!part || part.type !== 'text') return;
            const sid = part.sessionID;
            const mid = part.messageID;
            if (!sid || !mid) return;
            const delta = props.delta;
            const text = part.text || '';
            const entry = messageTexts.get(mid);
            if (entry) {
              entry.text += delta || text;
            } else {
              messageTexts.set(mid, {
                sessionID: sid,
                text: delta || text,
              });
            }
            break;
          }

          case 'message.updated': {
            const info = event.properties?.info as
              | {
                  id?: string;
                  sessionID?: string;
                  role?: string;
                  summary?: { body?: string };
                  time?: { completed?: boolean };
                }
              | undefined;
            if (!info) return;
            const sid = info.sessionID;
            const mid = info.id;
            if (!sid || !mid) return;

            if (info.role === 'user') {
              userMessageIds.add(mid);
              const buffered = messageTexts.get(mid);
              const text = info.summary?.body || buffered?.text || '';
              messageTexts.delete(mid);
              if (text.trim()) {
                await runHook('user-prompt-submit', {
                  session_id: sid,
                  prompt: text.trim(),
                });
              }
            } else if (info.role === 'assistant' && info.time?.completed) {
              await flushTurn(sid, mid);
            }
            break;
          }
        }
      } catch (err) {
        const msg = (err as Error)?.message || String(err);
        log(`event handler crash: ${msg.slice(0, 500)}`);
      }
    },

    'tool.execute.after': async (input, output) => {
      try {
        if (!input?.sessionID) return;
        await runHook('post-tool-use', {
          session_id: input.sessionID,
          tool_name: input.tool,
          tool_input: truncate(input.args, 500),
          tool_response: truncate(output?.output, 2000),
        });
      } catch (err) {
        const msg = (err as Error)?.message || String(err);
        log(`tool.execute.after crash: ${msg.slice(0, 500)}`);
      }
    },

    'experimental.chat.system.transform': async (input, output) => {
      try {
        const sid = input?.sessionID;
        if (!sid) return;
        output.system.push(
          'You have cavemem memory tools (search, timeline, get_observations, list_sessions). Use them when past context would help.',
        );
        const context = await getRecentContext(sid);
        if (context) {
          output.system.push(context);
        }
      } catch (err) {
        const msg = (err as Error)?.message || String(err);
        log(`system.transform crash: ${msg.slice(0, 500)}`);
      }
    },
  };
}
