import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  clampMaxResults,
  decodeEntities,
  enrichQuery,
  fetchPublic,
  htmlToText,
  isPublicHttpUrl,
  parseDdgResults,
  readBodyCapped,
  resolveDdgHref,
} from '../src/enrich.js';

const fixture = readFileSync(new URL('./fixtures/ddg-search.html', import.meta.url), 'utf8');

describe('parseDdgResults', () => {
  it('parses titles, resolved urls, and snippets from DDG html', () => {
    const results = parseDdgResults(fixture, 5);
    expect(results).toHaveLength(4);
    expect(results[0]).toEqual({
      title: 'Caveman Compression Guide & Reference',
      url: 'https://example.com/guide?ref=ddg',
      snippet: 'Learn how caveman grammar saves tokens — step by step.',
    });
    expect(results[1]).toEqual({
      title: 'Plain Link Post',
      url: 'https://plain.example.org/post',
      snippet: 'A result whose href is already a normal https link.',
    });
  });

  it('decodes entities in titles and snippets', () => {
    const results = parseDdgResults(fixture, 5);
    expect(results[2]?.snippet).toBe('Snippet with a non-breaking space and "quotes".');
  });

  it('dedupes results that resolve to the same url', () => {
    const urls = parseDdgResults(fixture, 5).map((r) => r.url);
    expect(new Set(urls).size).toBe(urls.length);
    expect(urls).not.toContain('https://ads.example.com/sponsored');
  });

  it('ignores ad blocks (result--ad has no results_links class)', () => {
    const titles = parseDdgResults(fixture, 5).map((r) => r.title);
    expect(titles).not.toContain('Sponsored: Buy Rocks');
  });

  it('caps at maxResults in document order', () => {
    const results = parseDdgResults(fixture, 2);
    expect(results.map((r) => r.title)).toEqual([
      'Caveman Compression Guide & Reference',
      'Plain Link Post',
    ]);
  });
});

describe('resolveDdgHref', () => {
  it('decodes the uddg redirect param', () => {
    expect(
      resolveDdgHref('//duckduckgo.com/l/?uddg=https%3A%2F%2Fa.example%2Fx%3Fy%3D1&rut=r'),
    ).toBe('https://a.example/x?y=1');
  });

  it('passes plain http(s) hrefs through unchanged', () => {
    expect(resolveDdgHref('https://plain.example.org/post')).toBe('https://plain.example.org/post');
  });

  it('rejects redirect targets that are not http(s)', () => {
    expect(resolveDdgHref('//duckduckgo.com/l/?uddg=javascript%3Aalert(1)&rut=r')).toBeNull();
  });
});

describe('htmlToText', () => {
  it('strips script/style/comments and tags, collapses whitespace', () => {
    const text = htmlToText(
      '<html><head><style>.x{}</style><script>evil()</script></head>' +
        '<body><!-- hidden --><h1>Title</h1>\n\n<p>Hello &amp;   world.</p></body></html>',
    );
    expect(text).toBe('Title Hello & world.');
  });
});

describe('decodeEntities', () => {
  it('decodes named and numeric entities, single pass', () => {
    expect(decodeEntities('&lt;a&gt; &quot;x&quot; &#39;y&#39; &#x2014; z&nbsp;!')).toBe(
      '<a> "x" \'y\' — z !',
    );
    // Double-encoded stays single-decoded.
    expect(decodeEntities('&amp;lt;')).toBe('&lt;');
    // Unknown entities are left alone.
    expect(decodeEntities('&mdash;&bogus;')).toBe('&mdash;&bogus;');
  });
});

describe('readBodyCapped', () => {
  it('stops reading at the byte cap', async () => {
    const big = new Response('x'.repeat(1_000_000));
    const text = await readBodyCapped(big, 1000);
    expect(text).toHaveLength(1000);
  });

  it('reads small bodies in full', async () => {
    const small = new Response('hello');
    expect(await readBodyCapped(small, 1000)).toBe('hello');
  });
});

function fetchStub(routes: Record<string, () => Response | Promise<Response>>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    for (const [prefix, make] of Object.entries(routes)) {
      if (url.startsWith(prefix)) return make();
    }
    throw new Error(`no route for ${url}`);
  }) as typeof fetch;
}

const page = (html: string) =>
  new Response(html, { status: 200, headers: { 'content-type': 'text/html' } });

describe('enrichQuery', () => {
  const cfg = { maxResults: 3, timeoutMs: 1000 };

  it('searches, fetches result pages, and returns plain-text extracts', async () => {
    const fetchImpl = fetchStub({
      'https://html.duckduckgo.com/html/': () => page(fixture),
      'https://example.com/guide': () =>
        page('<html><body><script>no()</script><p>Guide body &amp; details.</p></body></html>'),
      'https://plain.example.org/post': () => page('<p>Post body.</p>'),
      'https://docs.example.net/intro': () => page('<p>Intro body.</p>'),
    });
    const results = await enrichQuery('caveman compression', cfg, { fetchImpl });
    expect(results).toHaveLength(3);
    expect(results[0]).toEqual({
      title: 'Caveman Compression Guide & Reference',
      url: 'https://example.com/guide?ref=ddg',
      extract: 'Guide body & details.',
    });
  });

  it('truncates extracts to maxExtractChars', async () => {
    const fetchImpl = fetchStub({
      'https://html.duckduckgo.com/html/': () => page(fixture),
      'https:': () => page(`<p>${'word '.repeat(5000)}</p>`),
    });
    const results = await enrichQuery('q', { ...cfg, maxExtractChars: 50 }, { fetchImpl });
    for (const r of results) expect(r.extract.length).toBeLessThanOrEqual(50);
  });

  it('skips individual pages that fail and keeps the rest', async () => {
    const skipped: string[] = [];
    const fetchImpl = fetchStub({
      'https://html.duckduckgo.com/html/': () => page(fixture),
      'https://example.com/guide': () => {
        throw new Error('connect ECONNREFUSED');
      },
      'https://plain.example.org/post': () => page('<p>Post body.</p>'),
      'https://docs.example.net/intro': () => new Response('nope', { status: 500 }),
    });
    const results = await enrichQuery('q', cfg, { fetchImpl, log: (m) => skipped.push(m) });
    expect(results.map((r) => r.url)).toEqual(['https://plain.example.org/post']);
    expect(skipped).toHaveLength(2);
  });

  it('throws when the search request fails', async () => {
    const fetchImpl = fetchStub({
      'https://html.duckduckgo.com/html/': () => new Response('teapot', { status: 418 }),
    });
    await expect(enrichQuery('q', cfg, { fetchImpl })).rejects.toThrow('HTTP 418');
  });

  it('throws when the search returns no parseable results', async () => {
    const fetchImpl = fetchStub({
      'https://html.duckduckgo.com/html/': () => page('<html><body>no results here</body></html>'),
    });
    await expect(enrichQuery('q', cfg, { fetchImpl })).rejects.toThrow('no parseable results');
  });
});

describe('ReDoS resistance (linear-time parsing)', () => {
  // Quadratic backtracking previously took 34s on payloads like these.
  // Linear scanning finishes in milliseconds; the generous bound only
  // exists to absorb slow CI machines while still catching regressions.
  const BUDGET_MS = 500;

  function timed(fn: () => void): number {
    const t0 = performance.now();
    fn();
    return performance.now() - t0;
  }

  it('parseDdgResults survives 500KB of near-miss result divs', () => {
    const payload = '<div class="result ">'.repeat(24_000); // ~500KB, no results_links
    let out: unknown;
    const ms = timed(() => {
      out = parseDdgResults(payload, 5);
    });
    expect(out).toEqual([]);
    expect(ms).toBeLessThan(BUDGET_MS);
  });

  it('parseDdgResults survives 500KB of unclosed anchors inside a result block', () => {
    const payload = `<div class="result results_links">${'<a class="result__a" '.repeat(22_000)}`;
    let out: unknown;
    const ms = timed(() => {
      out = parseDdgResults(payload, 5);
    });
    expect(out).toEqual([]);
    expect(ms).toBeLessThan(BUDGET_MS);
  });

  it('htmlToText survives 500KB of unclosed script tags', () => {
    const payload = '<script'.repeat(70_000);
    let out = '';
    const ms = timed(() => {
      out = htmlToText(payload);
    });
    expect(out).toBe('');
    expect(ms).toBeLessThan(BUDGET_MS);
  });

  it('htmlToText survives 500KB of bare angle brackets', () => {
    const payload = '<'.repeat(500_000);
    const ms = timed(() => htmlToText(payload));
    expect(ms).toBeLessThan(BUDGET_MS);
  });

  it('htmlToText survives 500KB of unclosed comments and entities', () => {
    const payload = `<!--${'&aaaaaaaaaaaaaaaa'.repeat(30_000)}`;
    const ms = timed(() => htmlToText(payload));
    expect(ms).toBeLessThan(BUDGET_MS);
  });
});

describe('clampMaxResults', () => {
  it('clamps into [1, 5]', () => {
    expect(clampMaxResults(3)).toBe(3);
    expect(clampMaxResults(0)).toBe(1);
    expect(clampMaxResults(-7)).toBe(1);
    expect(clampMaxResults(99)).toBe(5);
    expect(clampMaxResults(Number.NaN)).toBe(1);
    expect(clampMaxResults(2.9)).toBe(2);
  });

  it('is enforced inside parseDdgResults', () => {
    expect(parseDdgResults(fixture, 99).length).toBeLessThanOrEqual(5);
    expect(parseDdgResults(fixture, 0)).toHaveLength(1);
  });
});

describe('isPublicHttpUrl (SSRF guard)', () => {
  it('accepts ordinary public urls', () => {
    expect(isPublicHttpUrl('https://example.com/page')).toBe(true);
    expect(isPublicHttpUrl('http://93.184.216.34/')).toBe(true);
    expect(isPublicHttpUrl('https://[2606:4700::6810:84e5]/')).toBe(true);
  });

  it('rejects loopback, private, and link-local hosts', () => {
    for (const url of [
      'http://127.0.0.1:8080/x',
      'http://127.1.2.3/',
      'http://localhost/x',
      'http://foo.localhost/x',
      'http://0.0.0.0/',
      'http://10.0.0.5/',
      'http://172.16.9.1/',
      'http://172.31.255.255/',
      'http://192.168.1.1/',
      'http://169.254.169.254/latest/meta-data/',
      'http://[::1]/',
      'http://[fd00::1]/',
      'http://[fe80::1]/',
    ]) {
      expect(isPublicHttpUrl(url), url).toBe(false);
    }
  });

  it('rejects obfuscated loopback literals (URL parser canonicalises them)', () => {
    expect(isPublicHttpUrl('http://2130706433/')).toBe(false); // 127.0.0.1 decimal
    expect(isPublicHttpUrl('http://0x7f000001/')).toBe(false); // 127.0.0.1 hex
    expect(isPublicHttpUrl('http://127.1/')).toBe(false); // short form
    expect(isPublicHttpUrl('http://[::ffff:127.0.0.1]/')).toBe(false); // mapped v4
  });

  it('rejects non-http(s) schemes and garbage', () => {
    expect(isPublicHttpUrl('ftp://example.com/')).toBe(false);
    expect(isPublicHttpUrl('file:///etc/passwd')).toBe(false);
    expect(isPublicHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isPublicHttpUrl('not a url')).toBe(false);
  });
});

describe('fetchPublic (manual redirect following)', () => {
  const redirect = (to: string) => new Response(null, { status: 302, headers: { location: to } });

  it('follows redirects between public hosts', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      if (url === 'https://a.example/start') return redirect('https://b.example/final');
      return new Response('final body');
    }) as typeof fetch;
    const res = await fetchPublic('https://a.example/start', fetchImpl, 1000);
    expect(await res.text()).toBe('final body');
    expect(calls).toEqual(['https://a.example/start', 'https://b.example/final']);
  });

  it('resolves relative redirect locations against the current url', async () => {
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url === 'https://a.example/start') return redirect('/moved');
      if (url === 'https://a.example/moved') return new Response('moved body');
      throw new Error(`unexpected ${url}`);
    }) as typeof fetch;
    const res = await fetchPublic('https://a.example/start', fetchImpl, 1000);
    expect(await res.text()).toBe('moved body');
  });

  it('blocks redirects to loopback without fetching them', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (input: string | URL | Request) => {
      calls.push(String(input));
      return redirect('http://127.0.0.1:8080/internal');
    }) as typeof fetch;
    await expect(fetchPublic('https://a.example/start', fetchImpl, 1000)).rejects.toThrow(
      /blocked non-public url/,
    );
    expect(calls).toEqual(['https://a.example/start']);
  });

  it('blocks a direct non-public url without any fetch', async () => {
    const fetchImpl = (async () => {
      throw new Error('must not be called');
    }) as typeof fetch;
    await expect(fetchPublic('http://192.168.1.1/', fetchImpl, 1000)).rejects.toThrow(
      /blocked non-public url/,
    );
  });

  it('gives up after too many redirect hops', async () => {
    const fetchImpl = (async (input: string | URL | Request) =>
      redirect(`${String(input)}x`)) as typeof fetch;
    await expect(fetchPublic('https://a.example/r', fetchImpl, 1000)).rejects.toThrow(
      /too many redirects/,
    );
  });
});

describe('enrichQuery SSRF integration', () => {
  const ddgHtml = (hrefs: string[]) =>
    `<html><body>${hrefs
      .map(
        (u, i) => `
<div class="result results_links web-result">
  <h2 class="result__title"><a class="result__a" href="${u}">Result ${i}</a></h2>
  <a class="result__snippet" href="${u}">Snippet ${i}</a>
</div>`,
      )
      .join('')}</body></html>`;

  it('skips result urls pointing at private hosts without fetching them', async () => {
    const fetched: string[] = [];
    const skipped: string[] = [];
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = String(input);
      fetched.push(url);
      if (url.startsWith('https://html.duckduckgo.com/html/')) {
        return new Response(ddgHtml(['http://192.168.1.1/router', 'https://ok.example/post']));
      }
      return new Response('<p>public body</p>');
    }) as typeof fetch;
    const results = await enrichQuery(
      'q',
      { maxResults: 3, timeoutMs: 1000 },
      { fetchImpl, log: (m) => skipped.push(m) },
    );
    expect(results.map((r) => r.url)).toEqual(['https://ok.example/post']);
    expect(fetched).not.toContain('http://192.168.1.1/router');
    expect(skipped.some((m) => m.includes('blocked non-public url'))).toBe(true);
  });

  it('skips result pages that redirect to loopback', async () => {
    const fetched: string[] = [];
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = String(input);
      fetched.push(url);
      if (url.startsWith('https://html.duckduckgo.com/html/')) {
        return new Response(ddgHtml(['https://evil.example/hop', 'https://ok.example/post']));
      }
      if (url === 'https://evil.example/hop') {
        return new Response(null, {
          status: 302,
          headers: { location: 'http://169.254.169.254/latest/meta-data/' },
        });
      }
      return new Response('<p>public body</p>');
    }) as typeof fetch;
    const results = await enrichQuery('q', { maxResults: 3, timeoutMs: 1000 }, { fetchImpl });
    expect(results.map((r) => r.url)).toEqual(['https://ok.example/post']);
    expect(fetched).not.toContain('http://169.254.169.254/latest/meta-data/');
  });
});
