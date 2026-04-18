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
