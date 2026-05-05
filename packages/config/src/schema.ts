import { z } from 'zod';

export const CompressionIntensity = z.enum(['lite', 'full', 'ultra']);
export type CompressionIntensity = z.infer<typeof CompressionIntensity>;

export const EmbeddingProvider = z.enum(['local', 'ollama', 'openai', 'none']);
export type EmbeddingProvider = z.infer<typeof EmbeddingProvider>;

export const SettingsSchema = z
  .object({
    dataDir: z
      .string()
      .default('~/.cavemem')
      .describe('Where cavemem stores its SQLite database, models, pidfile, and logs.'),
    workerPort: z
      .number()
      .int()
      .positive()
      .default(37777)
      .describe('Port the local worker binds to on 127.0.0.1.'),
    logLevel: z
      .enum(['debug', 'info', 'warn', 'error'])
      .default('info')
      .describe('Minimum log level emitted by the worker and hook handlers.'),
    compression: z
      .object({
        intensity: CompressionIntensity.default('full').describe(
          'Caveman grammar intensity. lite ≈ 30% savings, full ≈ 60%, ultra ≈ 75%.',
        ),
        expandForModel: z
          .boolean()
          .default(false)
          .describe('If true, MCP get_observations returns expanded text; if false, compressed.'),
      })
      .default({ intensity: 'full', expandForModel: false })
      .describe('Write-path compression settings.'),
    embedding: z
      .object({
        provider: EmbeddingProvider.default('local').describe(
          'Embedding provider: local (Transformers.js, default), ollama, openai, or none.',
        ),
        model: z
          .string()
          .default('Xenova/all-MiniLM-L6-v2')
          .describe(
            'Embedding model id. Switching models clears existing vectors and re-embeds on next worker start.',
          ),
        endpoint: z.string().optional().describe('Remote endpoint for ollama / openai providers.'),
        apiKey: z.string().optional().describe('API key for remote providers.'),
        batchSize: z
          .number()
          .int()
          .positive()
          .default(16)
          .describe('How many observations the worker embeds per backfill batch.'),
        autoStart: z
          .boolean()
          .default(true)
          .describe(
            'If true, hooks detach-spawn the worker when it is not running so embeddings happen without manual start.',
          ),
        idleShutdownMs: z
          .number()
          .int()
          .positive()
          .default(600_000)
          .describe(
            'Milliseconds the worker stays idle (no embed work, no viewer traffic) before self-exiting.',
          ),
      })
      .default({
        provider: 'local',
        model: 'Xenova/all-MiniLM-L6-v2',
        batchSize: 16,
        autoStart: true,
        idleShutdownMs: 600_000,
      })
      .describe('Embedding / vector search settings.'),
    search: z
      .object({
        alpha: z
          .number()
          .min(0)
          .max(1)
          .default(0.5)
          .describe('Hybrid rank weight: 0 = pure cosine, 1 = pure BM25, 0.5 = balanced.'),
        defaultLimit: z
          .number()
          .int()
          .positive()
          .default(10)
          .describe('Default number of hits returned when no limit is given.'),
      })
      .default({ alpha: 0.5, defaultLimit: 10 })
      .describe('Search ranking defaults.'),
    privacy: z
      .object({
        excludePatterns: z
          .array(z.string())
          .default([])
          .describe('Glob patterns; matching paths are never read or stored.'),
        redactSecrets: z
          .boolean()
          .default(true)
          .describe('Strip content inside <private>…</private> tags before compression.'),
      })
      .default({ excludePatterns: [], redactSecrets: true })
      .describe('Privacy / redaction.'),
    ides: z
      .record(z.string(), z.boolean())
      .default({})
      .describe('Installed IDE integrations (set by `cavemem install`).'),
  })
  .strict();

export type Settings = z.infer<typeof SettingsSchema>;
