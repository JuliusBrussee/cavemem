/**
 * Web-search enrichment (phase 1): DuckDuckGo's HTML endpoint, no API key.
 * Pure module — no MCP or storage imports — so the parser and fetch logic
 * are unit-testable with an injected fetch and saved fixtures. Network is
 * only ever reached from here, and only when the enrich tool (opt-in via
 * settings.enrich.enabled) is explicitly called.
 *
 * Hardening notes:
 * - All HTML scanning is index-based and single-pass. Regexes only ever run
 *   on short, pre-bounded slices (a single tag's attributes) or use bounded
 *   quantifiers, so adversarial page bodies cannot trigger quadratic
 *   backtracking and stall the single-threaded MCP server.
 * - Every fetched URL (including each redirect hop, followed manually) is
 *   rejected unless it is http(s) to a public host — no loopback, RFC1918,
 *   link-local, or unique-local targets. See isPublicHttpUrl.
 */

const USER_AGENT = 'cavemem-enrich/1 (+https://github.com/JuliusBrussee/cavemem)';
const DEFAULT_MAX_PAGE_BYTES = 500_000;
const DEFAULT_MAX_EXTRACT_CHARS = 2000;
const MAX_RESULTS_HARD_CAP = 5;
const MAX_REDIRECT_HOPS = 3;
// An honest opening tag fits well within this; anything longer is treated as malformed.
const MAX_TAG_LEN = 2000;

export interface DdgResult {
  title: string;
  url: string;
  snippet: string;
}

export interface EnrichedResult {
  title: string;
  url: string;
  extract: string;
}

export interface EnrichConfig {
  maxResults: number;
  timeoutMs: number;
  maxPageBytes?: number;
  maxExtractChars?: number;
}

export interface EnrichDeps {
  fetchImpl?: typeof fetch;
  log?: (msg: string) => void;
}

/** The module owns its own bounds — callers cannot exceed the hard cap. */
export function clampMaxResults(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.min(Math.max(1, Math.floor(n)), MAX_RESULTS_HARD_CAP);
}

/**
 * Search DuckDuckGo, fetch the top result pages, and return plain-text
 * extracts. Throws if the search itself fails or yields nothing parseable;
 * individual page failures (including blocked non-public URLs) are logged
 * and skipped so one dead link does not sink the whole call.
 */
export async function enrichQuery(
  query: string,
  cfg: EnrichConfig,
  deps: EnrichDeps = {},
): Promise<EnrichedResult[]> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const log = deps.log ?? (() => {});
  const maxPageBytes = cfg.maxPageBytes ?? DEFAULT_MAX_PAGE_BYTES;
  const maxExtractChars = cfg.maxExtractChars ?? DEFAULT_MAX_EXTRACT_CHARS;

  const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const res = await fetchPublic(searchUrl, fetchImpl, cfg.timeoutMs);
  if (!res.ok) throw new Error(`web search failed: HTTP ${res.status}`);
  const html = await readBodyCapped(res, maxPageBytes);
  const hits = parseDdgResults(html, clampMaxResults(cfg.maxResults));
  if (hits.length === 0) throw new Error('web search returned no parseable results');

  const enriched: EnrichedResult[] = [];
  for (const hit of hits) {
    try {
      const page = await fetchPublic(hit.url, fetchImpl, cfg.timeoutMs);
      if (!page.ok) throw new Error(`HTTP ${page.status}`);
      const body = await readBodyCapped(page, maxPageBytes);
      const text = htmlToText(body).slice(0, maxExtractChars);
      // A page that strips to nothing (e.g. JS-only shell) still has the
      // search snippet as a usable extract.
      enriched.push({ title: hit.title, url: hit.url, extract: text || hit.snippet });
    } catch (err) {
      log(`enrich: skipped ${hit.url}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return enriched;
}

/**
 * Fetch with SSRF protection: the URL and every redirect hop must pass
 * isPublicHttpUrl. Redirects are followed manually (capped) because
 * redirect:'follow' would happily hop to 127.0.0.1 or 169.254.169.254.
 */
export async function fetchPublic(
  rawUrl: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<Response> {
  let url = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
    if (!isPublicHttpUrl(url)) throw new Error(`blocked non-public url: ${url}`);
    const res = await fetchImpl(url, {
      headers: { 'user-agent': USER_AGENT },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'manual',
    });
    if (res.status < 300 || res.status >= 400) return res;
    const location = res.headers.get('location');
    if (!location) throw new Error(`redirect without location: HTTP ${res.status}`);
    url = new URL(location, url).toString();
  }
  throw new Error(`too many redirects (max ${MAX_REDIRECT_HOPS})`);
}

/**
 * True only for http(s) URLs whose host is publicly routable. The WHATWG URL
 * parser canonicalises numeric hosts (hex/decimal/short IPv4 forms become
 * dotted decimal, IPv6 is normalised), so checking the parsed hostname also
 * catches obfuscated literals like http://2130706433/.
 */
export function isPublicHttpUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  return isPublicHost(url.hostname.toLowerCase());
}

function isPublicHost(hostname: string): boolean {
  const host =
    hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
  if (host === '' || host === 'localhost' || host.endsWith('.localhost')) return false;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) return isPublicV4(Number(v4[1]), Number(v4[2]));
  if (host.includes(':')) {
    if (host === '::' || host === '::1') return false;
    if (/^f[cd]/.test(host)) return false; // fc00::/7 unique-local
    if (/^fe[89ab]/.test(host)) return false; // fe80::/10 link-local
    // IPv4-mapped: canonicalised by the URL parser to ::ffff:HHHH:HHHH.
    const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host);
    if (mapped) {
      const hi = Number.parseInt(mapped[1] ?? '0', 16);
      return isPublicV4(hi >> 8, hi & 0xff);
    }
    return true;
  }
  return true;
}

function isPublicV4(a: number, b: number): boolean {
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  return true;
}

/**
 * Parse organic results out of the DDG HTML endpoint markup. Hand-rolled on
 * purpose: the repo bans heavy HTML deps, and the endpoint's markup is a
 * small stable shape (result blocks with `result__a` title anchors and
 * `result__snippet` bodies). Index-based scanning keeps worst case linear.
 */
export function parseDdgResults(html: string, maxResults: number): DdgResult[] {
  const cap = clampMaxResults(maxResults);
  const results: DdgResult[] = [];
  const seen = new Set<string>();
  for (const block of splitResultBlocks(html)) {
    const anchor = findClassElement(block, ['a'], 'result__a');
    if (!anchor) continue;
    const href = /\bhref\s*=\s*"([^"]{0,3000})"/.exec(anchor.attrs)?.[1];
    if (!href) continue;
    const url = resolveDdgHref(decodeEntities(href));
    if (!url || seen.has(url)) continue;
    const title = htmlToText(anchor.inner);
    if (!title) continue;
    const snippet = findClassElement(block, ['a', 'div'], 'result__snippet');
    seen.add(url);
    results.push({ title, url, snippet: snippet ? htmlToText(snippet.inner) : '' });
    if (results.length >= cap) break;
  }
  return results;
}

/**
 * Slice the page into chunks starting at each organic result container — a
 * <div> whose class list has both `result` and `results_links` tokens (ads
 * carry `result--ad` and lack `results_links`).
 */
function splitResultBlocks(html: string): string[] {
  const starts: number[] = [];
  let pos = 0;
  for (;;) {
    const div = html.indexOf('<div', pos);
    if (div === -1) break;
    pos = div + 4;
    const end = tagEnd(html, div);
    if (end === -1) continue;
    const cls = classAttr(html.slice(div, end));
    if (cls && hasToken(cls, 'result') && hasToken(cls, 'results_links')) starts.push(div);
  }
  return starts.map((s, i) => html.slice(s, starts[i + 1] ?? html.length));
}

interface ClassElement {
  attrs: string;
  inner: string;
}

/** Find the first element among tagNames whose class list contains classToken. */
function findClassElement(
  block: string,
  tagNames: readonly string[],
  classToken: string,
): ClassElement | null {
  const lower = block.toLowerCase();
  let pos = 0;
  for (;;) {
    const lt = lower.indexOf('<', pos);
    if (lt === -1) return null;
    pos = lt + 1;
    const name = tagNames.find(
      (t) => lower.startsWith(t, lt + 1) && !isTagNameChar(lower.charCodeAt(lt + 1 + t.length)),
    );
    if (!name) continue;
    const end = tagEnd(lower, lt);
    if (end === -1) continue;
    const attrs = block.slice(lt + 1 + name.length, end);
    const cls = classAttr(attrs);
    if (!cls || !hasToken(cls, classToken)) continue;
    const close = lower.indexOf(`</${name}`, end + 1);
    if (close === -1) return null;
    return { attrs, inner: block.slice(end + 1, close) };
  }
}

/**
 * End ('>') of the tag opening at `lt`, scanning at most MAX_TAG_LEN chars
 * and never past the next '<'. Bounded so malformed input costs O(1) per tag.
 */
function tagEnd(s: string, lt: number): number {
  const limit = Math.min(lt + MAX_TAG_LEN, s.length);
  for (let i = lt + 1; i < limit; i++) {
    const c = s.charCodeAt(i);
    if (c === 62 /* > */) return i;
    if (c === 60 /* < */) return -1;
  }
  return -1;
}

function classAttr(tag: string): string | null {
  // Only ever applied to a single tag's text, already bounded by tagEnd.
  return /\bclass\s*=\s*"([^"]{0,1000})"/.exec(tag)?.[1] ?? null;
}

function hasToken(cls: string, token: string): boolean {
  return cls.split(/\s+/).includes(token);
}

function isTagNameChar(c: number): boolean {
  return (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || (c >= 48 && c <= 57);
}

/**
 * DDG wraps result targets in a redirect: `//duckduckgo.com/l/?uddg=<url>&rut=…`.
 * Decode the real target; pass plain http(s) hrefs through unchanged.
 */
export function resolveDdgHref(href: string): string | null {
  if (/^https?:\/\//.test(href)) return href;
  const redirect = href.indexOf('/l/?');
  if (redirect !== -1) {
    const uddg = new URLSearchParams(href.slice(redirect + 4)).get('uddg');
    return uddg && /^https?:\/\//.test(uddg) ? uddg : null;
  }
  if (href.startsWith('//')) return `https:${href}`;
  return null;
}

/**
 * Strip script/style/comments, then all tags; decode entities; collapse
 * whitespace. Single forward pass — position only ever advances, so
 * pathological input (unclosed tags, repeated '<script') stays linear.
 */
export function htmlToText(html: string): string {
  const lower = html.toLowerCase();
  const parts: string[] = [];
  let pos = 0;
  for (;;) {
    const lt = html.indexOf('<', pos);
    if (lt === -1) {
      parts.push(html.slice(pos));
      break;
    }
    parts.push(html.slice(pos, lt), ' ');
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      if (end === -1) break; // unclosed comment: drop the rest
      pos = end + 3;
      continue;
    }
    const rawTag = ['script', 'style'].find(
      (t) => lower.startsWith(t, lt + 1) && !isTagNameChar(lower.charCodeAt(lt + 1 + t.length)),
    );
    if (rawTag) {
      const close = lower.indexOf(`</${rawTag}`, lt + 1);
      if (close === -1) break; // unclosed script/style: drop the rest
      const gt = html.indexOf('>', close);
      if (gt === -1) break;
      pos = gt + 1;
      continue;
    }
    const gt = html.indexOf('>', lt + 1);
    if (gt === -1) break; // unclosed tag: drop the rest
    pos = gt + 1;
  }
  return decodeEntities(parts.join('')).replace(/\s+/g, ' ').trim();
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

export function decodeEntities(s: string): string {
  // Bounded quantifiers: entity names are short, so scanning stays linear.
  return s.replace(/&(#[xX][0-9a-fA-F]{1,6}|#\d{1,7}|[a-zA-Z]{1,31});/g, (whole, name: string) => {
    if (name.startsWith('#')) {
      const hex = name[1] === 'x' || name[1] === 'X';
      const code = Number.parseInt(name.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isNaN(code) || code > 0x10ffff ? whole : String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[name.toLowerCase()] ?? whole;
  });
}

/**
 * Read a response body up to `cap` bytes, then cancel the stream. Reads the
 * actual stream instead of trusting content-length, which can be absent or
 * wrong.
 */
export async function readBodyCapped(res: Response, cap: number): Promise<string> {
  const body = res.body;
  if (!body) return '';
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.byteLength;
      if (total >= cap) {
        await reader.cancel().catch(() => {});
        break;
      }
    }
  }
  const size = Math.min(total, cap);
  const buf = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    const remaining = size - offset;
    if (remaining <= 0) break;
    buf.set(chunk.byteLength > remaining ? chunk.subarray(0, remaining) : chunk, offset);
    offset += Math.min(chunk.byteLength, remaining);
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(buf);
}
