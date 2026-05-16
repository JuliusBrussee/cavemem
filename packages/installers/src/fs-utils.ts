import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

export function writeJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

/**
 * Normalize a path to forward-slash form. Windows accepts forward slashes
 * in every API we hand the path to (CreateProcess, cmd.exe, PowerShell,
 * Node spawn), and unlike backslashes they survive intact when the path
 * is later interpolated into a shell command string and passed through
 * bash. Use this on every path that ends up inside a shell `command`
 * field (e.g., Claude Code hooks). Paths that go into a `command` +
 * `args[]` spawn (no shell) don't need it.
 */
export function posixPath(p: string): string {
  return p.replace(/\\/g, '/');
}

/**
 * Quote a path for embedding into a shell command string (e.g., Claude
 * Code hook `command` fields). Wraps in double quotes unless the path is
 * already a bare token with no whitespace or shell metacharacters.
 *
 * Callers must pass a forward-slash-normalized path (see `posixPath`).
 * Embedding raw Windows backslash paths in a bash command string causes
 * silent collapse — bash drops every `\<letter>` that isn't a defined
 * escape, turning `C:\Users\hp\node.exe` into `C:Usershpnode.exe`.
 */
export function shellQuote(p: string): string {
  if (/^[\w@%+=:,./-]+$/.test(p)) return p;
  return `"${p.replace(/"/g, '\\"')}"`;
}

export function deepMerge<T>(base: T, add: Partial<T>): T {
  const out = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(add as Record<string, unknown>)) {
    const existing = out[k];
    if (
      existing &&
      typeof existing === 'object' &&
      !Array.isArray(existing) &&
      v &&
      typeof v === 'object' &&
      !Array.isArray(v)
    ) {
      out[k] = deepMerge(existing as Record<string, unknown>, v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out as T;
}
