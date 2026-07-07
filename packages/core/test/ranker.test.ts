import { describe, expect, it } from 'vitest';
import { hybridRank } from '../src/ranker.js';

describe('hybridRank', () => {
  it('returns sorted results', () => {
    const ranked = hybridRank(
      [
        { id: 1, bm25: 0.1, cosine: 0.9 },
        { id: 2, bm25: 0.9, cosine: 0.1 },
        { id: 3, bm25: 0.5, cosine: 0.5 },
      ],
      0.5,
    );
    expect(ranked[0]?.score).toBeGreaterThanOrEqual(ranked[1]?.score ?? 0);
  });
  it('alpha=1 prefers keyword', () => {
    const ranked = hybridRank(
      [
        { id: 1, bm25: 0.1, cosine: 0.9 },
        { id: 2, bm25: 0.9, cosine: 0.1 },
      ],
      1,
    );
    expect(ranked[0]?.id).toBe(2);
  });
  it('alpha=0 prefers vector', () => {
    const ranked = hybridRank(
      [
        { id: 1, bm25: 0.1, cosine: 0.9 },
        { id: 2, bm25: 0.9, cosine: 0.1 },
      ],
      0,
    );
    expect(ranked[0]?.id).toBe(1);
  });
  it('handles corpus-sized candidate sets without stack overflow', () => {
    const items = Array.from({ length: 150_000 }, (_, i) => ({
      id: i,
      bm25: Math.sin(i),
      cosine: Math.cos(i),
    }));
    const ranked = hybridRank(items, 0.5);
    expect(ranked).toHaveLength(150_000);
    expect(ranked[0]!.score).toBeGreaterThanOrEqual(ranked[149_999]!.score);
  });
});
