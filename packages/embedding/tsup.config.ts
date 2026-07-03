import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  // Keep @huggingface/transformers external — it's an optionalDependency, and
  // bundling it drags in ONNX runtime + sharp into our dist.
  external: ['@huggingface/transformers', '@cavemem/config'],
});
