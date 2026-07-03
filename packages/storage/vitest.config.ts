import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // src/bun.test.ts targets the bun:test runner (`bun test`), not vitest —
    // it imports 'bun:sqlite'/'bun:test', which don't resolve under Node.
    exclude: [...configDefaults.exclude, 'src/bun.test.ts'],
  },
});
