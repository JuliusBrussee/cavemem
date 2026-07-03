/**
 * Web-search enrichment (phase 1): DuckDuckGo's HTML endpoint, no API key.
 * Pure module — no MCP or storage imports — so the parser and fetch logic
 * are unit-testable with an injected fetch and saved fixtures. Network is
 * only ever reached from here, and only when the enrich tool (opt-in via
 * settings.enrich.enabled) is explicitly called.
 */

const USER_AGENT = 'cavemem-enrich/1 (+https://github.com/JuliusBrussee/cavemem)';
const DEFAULT_MAX_PAGE_BYTES = 500_000;
const DEFAULT_MAX_EXTRACT_CHARS = 2000;

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

/**
 * Search DuckDuckGo, fetch the top result pages, and return plain-text
 * extracts. Throws if the search itself fails or yields nothing parseable;
 * individual page failures are logged and skipped so one dead link does not
 * sink the whole call.
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
  const res = await fetchImpl(searchUrl, {
    headers: { 'user-agent': USER_AGENT },
    signal: AbortSignal.timeout(cfg.timeoutMs),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`web search failed: HTTP ${res.status}`);
  const html = await readBodyCapped(res, maxPageBytes);
  const hits = parseDdgResults(html, cfg.maxResults);
  if (hits.length === 0) throw new Error('web search returned no parseable results');

  const enriched: EnrichedResult[] = [];
  for (const hit of hits) {
    try {
      const page = await fetchImpl(hit.url, {
        headers: { 'user-agent': USER_AGENT },
        signal: AbortSignal.timeout(cfg.timeoutMs),
        redirect: 'follow',
      });
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
 * Parse organic results out of the DDG HTML endpoint markup. Hand-rolled on
 * purpose: the repo bans heavy HTML deps, and the endpoint's markup is a
 * small stable shape (result blocks with `result__a` title anchors and
 * `result__snippet` bodies).
 */
export function parseDdgResults(html: string, maxResults: number): DdgResult[] {
  const results: DdgResult[] = [];
  const seen = new Set<string>();
  // Each organic result container carries both `result` and `results_links`
  // classes; ads (`result--ad`) do not and are skipped by the split.
  const blocks = html
    .split(/<div[^>]*\bclass="[^"]*\bresult\b[^"]*\bresults_links\b[^"]*"/)
    .slice(1);
  for (const block of blocks) {
    const anchor = /<a\b([^>]*\bclass="[^"]*\bresult__a\b[^"]*"[^>]*)>([\s\S]*?)<\/a>/.exec(block);
    if (!anchor) continue;
    const href = /\bhref="([^"]*)"/.exec(anchor[1] ?? '')?.[1];
    if (!href) continue;
    const url = resolveDdgHref(decodeEntities(href));
    if (!url || seen.has(url)) continue;
    const title = htmlToText(anchor[2] ?? '');
    if (!title) continue;
    const snippetMatch =
      /<(a|div)\b[^>]*\bclass="[^"]*\bresult__snippet\b[^"]*"[^>]*>([\s\S]*?)<\/\1>/.exec(block);
    seen.add(url);
    results.push({ title, url, snippet: snippetMatch ? htmlToText(snippetMatch[2] ?? '') : '' });
    if (results.length >= maxResults) break;
  }
  return results;
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

/** Strip script/style/comments, then all tags; decode entities; collapse whitespace. */
export function htmlToText(html: string): string {
  const stripped = html
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities(stripped).replace(/\s+/g, ' ').trim();
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
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, name: string) => {
    if (name.startsWith('#x') || name.startsWith('#X')) {
      const code = Number.parseInt(name.slice(2), 16);
      return Number.isNaN(code) ? whole : String.fromCodePoint(code);
    }
    if (name.startsWith('#')) {
      const code = Number.parseInt(name.slice(1), 10);
      return Number.isNaN(code) ? whole : String.fromCodePoint(code);
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
