import type { SessionRow } from '@cavemem/storage';

const style = `
  body { font: 14px/1.5 -apple-system, system-ui, sans-serif; margin: 0; background: #0b0d10; color: #e6e6e6; }
  header { padding: 16px 24px; border-bottom: 1px solid #222; }
  main { padding: 24px; max-width: 960px; margin: 0 auto; }
  a { color: #7aa2ff; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .card { background: #13161b; border: 1px solid #222; border-radius: 8px; padding: 12px 16px; margin-bottom: 10px; }
  .meta { color: #8a94a3; font-size: 12px; }
  pre { white-space: pre-wrap; word-break: break-word; }
  h1 { margin: 0 0 4px; font-size: 20px; }
  h2 { margin: 0 0 12px; font-size: 16px; color: #cfd5de; }
  code { background: #1d2129; padding: 1px 4px; border-radius: 3px; }
`;

function layout(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>${style}</style></head><body><header><h1>cavemem</h1><div class="meta">local memory viewer</div></header><main>${body}</main></body></html>`;
}

function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
}

export function renderIndex(sessions: SessionRow[]): string {
  if (sessions.length === 0) return layout('cavemem', '<p>No sessions yet.</p>');
  const items = sessions
    .map(
      (s) => `
      <div class="card">
        <a href="/sessions/${esc(s.id)}"><strong>${esc(s.id)}</strong></a>
        <div class="meta">${esc(s.ide)} · ${esc(s.cwd ?? '')} · ${new Date(s.started_at).toISOString()}</div>
      </div>`,
    )
    .join('');
  return layout('cavemem · sessions', `<h2>Recent sessions</h2>${items}`);
}

export function renderSession(
  session: SessionRow,
  observations: Array<{ id: number; kind: string; ts: number; content: string }>,
): string {
  const rows = observations
    .map(
      (o) => `
      <div class="card">
        <div class="meta">#${o.id} · ${esc(o.kind)} · ${new Date(o.ts).toISOString()}</div>
        <pre>${esc(o.content)}</pre>
      </div>`,
    )
    .join('');
  return layout(
    `cavemem · ${session.id}`,
    `<h2>${esc(session.id)} <span class="meta">(${esc(session.ide)})</span></h2><p><a href="/">&larr; all sessions</a></p>${rows}`,
  );
}
