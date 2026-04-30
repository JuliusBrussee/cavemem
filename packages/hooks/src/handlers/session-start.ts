import type { MemoryStore } from '@cavemem/core';
import type { HookInput } from '../types.js';

export async function sessionStart(store: MemoryStore, input: HookInput): Promise<string> {
  // Idempotent: Claude Code re-fires SessionStart on resume/clear/compact with
  // the same session_id. We must not blow up on the duplicate.
  store.startSession({
    id: input.session_id,
    ide: input.ide ?? 'unknown',
    cwd: input.cwd ?? null,
  });
  // For resume/clear/compact the agent already has its own context; injecting
  // a "Prior-session context" preface would be noisy and possibly stale.
  if (input.source && input.source !== 'startup') return '';
  const recent = store.storage.listSessions(30);
  const hints = recent
    .filter((s) => s.id !== input.session_id && s.cwd === input.cwd)
    .slice(0, 3)
    .map((s) => {
      const summaries = store.storage.listSummaries(s.id).slice(0, 1);
      return summaries.map((x) => x.content).join('\n');
    })
    .filter(Boolean);
  if (hints.length === 0) return '';
  return `## Prior-session context\n${hints.join('\n---\n')}`;
}
