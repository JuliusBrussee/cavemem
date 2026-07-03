import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Settings } from '@cavemem/config';
import { resolveDataDir } from '@cavemem/config';
import type { MiddlewareHandler } from 'hono';

/**
 * The worker binds to 127.0.0.1 only, but that alone doesn't stop (a) a
 * malicious web page doing a CSRF/DNS-rebinding fetch to 127.0.0.1:<port>,
 * or (b) another local user/process on the same machine. Three layers:
 *   1. Host header allowlist — kills DNS rebinding.
 *   2. Origin header check — kills browser-page CSRF (no CORS headers added).
 *   3. Bearer token on /api/* — kills same-origin-but-unauthenticated access.
 */

export function tokenFilePath(settings: Settings): string {
  return join(resolveDataDir(settings.dataDir), 'worker-token');
}

/** Reuse the token across restarts; generate + persist (mode 0600) on first run. */
export function getOrCreateToken(settings: Settings): string {
  const path = tokenFilePath(settings);
  if (existsSync(path)) {
    const existing = readFileSync(path, 'utf8').trim();
    if (existing) return existing;
  }
  const token = randomBytes(32).toString('hex');
  mkdirSync(dirname(path), { recursive: true });
  // mode here narrows perms at creation time (umask can still widen it);
  // chmod afterward guarantees 0600 regardless of umask.
  writeFileSync(path, token, { encoding: 'utf8', mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    // Best effort — e.g. no posix perms on this platform.
  }
  return token;
}

function isAllowedHost(header: string | undefined, port: number): boolean {
  return header === `127.0.0.1:${port}` || header === `localhost:${port}`;
}

export function hostAllowlist(port: number): MiddlewareHandler {
  return async (c, next) => {
    if (!isAllowedHost(c.req.header('host'), port)) {
      return c.text('Forbidden', 403);
    }
    await next();
  };
}

export function originCheck(port: number): MiddlewareHandler {
  return async (c, next) => {
    const origin = c.req.header('origin');
    if (origin && origin !== `http://127.0.0.1:${port}` && origin !== `http://localhost:${port}`) {
      return c.text('Forbidden', 403);
    }
    await next();
  };
}

export function bearerAuth(token: string): MiddlewareHandler {
  return async (c, next) => {
    const header = c.req.header('authorization');
    const bearer = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    const supplied = bearer ?? c.req.header('x-cavemem-token');
    if (supplied !== token) {
      return c.text('Unauthorized', 401);
    }
    await next();
  };
}
