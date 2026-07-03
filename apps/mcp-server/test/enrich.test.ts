import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  decodeEntities,
  enrichQuery,
  htmlToText,
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
