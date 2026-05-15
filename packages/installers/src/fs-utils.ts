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
 * Quote a path for embedding into a shell command string (e.g., Claude
 * Code hook `command` fields). Wraps in double quotes unless the path is
 * already a bare token with no whitespace, shell metacharacters, or
 * backslashes.
 *
 * Backslashes force quoting because on Windows the hook `command` string
 * is frequently executed under Git Bash / MSYS-bash (e.g., when launched
 * from Claude Code on Windows). MSYS argv parsing treats unquoted
 * backslashes as escape introducers and strips them, turning a path like
 *   C:\Users\foo\AppData\Roaming\npm\node_modules\cavemem\dist\index.js
 * into
 *   CUsersfooAppDataRoamingnpmnode_modulescavememdistindex.js
 * which Node then resolves against cwd and fails with MODULE_NOT_FOUND.
 * Quoting the path preserves the backslashes verbatim under both cmd.exe
 * and MSYS-bash.
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
