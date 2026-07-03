import { detectMusl } from '../libc.js';
import type { Embedder, EmbeddingFactoryOptions } from '../types.js';

// Known model dimensions — lets callers build an Embedder without waiting for
// the first embed() call to discover dim. If the model isn't in this table,
// the loader infers dim from the first embed call and caches it on the instance.
const MODEL_DIMS: Record<string, number> = {
  'Xenova/all-MiniLM-L6-v2': 384,
  'Xenova/all-MiniLM-L12-v2': 384,
  'Xenova/all-mpnet-base-v2': 768,
  'Xenova/bge-small-en-v1.5': 384,
  'Xenova/bge-base-en-v1.5': 768,
  'Xenova/gte-small': 384,
  'Xenova/gte-base': 768,
};

/**
 * Local embedder backed by @huggingface/transformers. Imports the package
 * lazily so installations with provider="none" or a remote provider don't pay
 * the ONNX runtime cost just to load the config.
 */
export async function createLocalEmbedder(
  model: string,
  opts: EmbeddingFactoryOptions = {},
): Promise<Embedder> {
  const log = opts.log ?? (() => {});

  // Guard against the musl segfault (issue #20). @huggingface/transformers
  // pulls in onnxruntime-node, whose prebuilts target glibc; loading them on
  // Alpine / musl-built Node aborts the process. Surface a clean error instead.
  const muslProbe = detectMusl();
  if (muslProbe.isMusl) {
    throw new Error(
      `Local embedding provider is not supported on musl libc (${muslProbe.reason ?? 'unknown'}). Set embedding.provider to 'none' or 'ollama' in ~/.cavemem/settings.json.`,
    );
  }

  log(`[cavemem:embed] loading local model ${model}`);
  const transformers = (await import('@huggingface/transformers').catch((err) => {
    throw new Error(
      `Local embedding provider requires @huggingface/transformers. Install it or set embedding.provider to 'none'. (${String(
        err,
      )})`,
    );
  })) as typeof import('@huggingface/transformers');

  if (opts.cacheDir) {
    transformers.env.cacheDir = opts.cacheDir;
    // Let the model load from disk without hitting the Hub if already cached.
    transformers.env.allowLocalModels = true;
  }

  // transformers v3 replaced the v2 `quantized: true` boolean with a `dtype`
  // selector; 'q8' is the int8-quantized weight set, matching the old default.
  const extractor = await transformers.pipeline('feature-extraction', model, {
    dtype: 'q8',
  });

  let dim = MODEL_DIMS[model] ?? 0;

  const embed = async (text: string): Promise<Float32Array> => {
    const out = await extractor(text, { pooling: 'mean', normalize: true });
    // Tensor.data is a typed array — for mean-pooled sentence embeddings it's
    // a single row whose length === dim. Copy into a dense Float32Array the
    // storage layer can persist directly.
    const data = (out as { data: ArrayLike<number> }).data;
    const vec = new Float32Array(data.length);
    for (let i = 0; i < data.length; i++) vec[i] = data[i] ?? 0;
    if (dim === 0) dim = vec.length;
    return vec;
  };

  // Force one warm-up embed so dim is known before first real call — keeps
  // the Embedder contract honest (dim is readonly and must be correct).
  if (dim === 0) {
    const probe = await embed(' ');
    dim = probe.length;
  }

  return {
    model,
    get dim() {
      return dim;
    },
    embed,
  };
}
