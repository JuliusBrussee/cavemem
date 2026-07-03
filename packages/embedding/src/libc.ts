import { existsSync, readFileSync } from 'node:fs';

export interface LibcProbeResult {
  /** True if the runtime is detected as musl (e.g. Alpine, musl-built Node). */
  isMusl: boolean;
  /** Human-readable reason, suitable for error messages. */
  reason?: string;
}

export interface LibcProbeIO {
  platform?: NodeJS.Platform;
  /** Returns process.report.getReport() shape or undefined. */
  getReport?: () => { header?: { glibcVersionRuntime?: string } } | undefined;
  readFile?: (path: string) => string | undefined;
  exists?: (path: string) => boolean;
}

/**
 * Detect whether the current Node.js binary is linked against musl libc.
 * @huggingface/transformers pulls in `onnxruntime-node`, whose prebuilt
 * binaries target glibc; loading them on Alpine / musl-built Node has
 * segfaulted in the wild (issue #20). We detect early so the failure is a
 * clean error instead of a process abort.
 */
export function detectMusl(io: LibcProbeIO = {}): LibcProbeResult {
  const platform = io.platform ?? process.platform;
  if (platform !== 'linux') return { isMusl: false };

  const getReport =
    io.getReport ??
    (() => {
      const report = (
        process as unknown as {
          report?: { getReport?: () => { header?: { glibcVersionRuntime?: string } } };
        }
      ).report;
      return report?.getReport?.();
    });
  try {
    const report = getReport();
    if (report && !report.header?.glibcVersionRuntime) {
      return {
        isMusl: true,
        reason: 'Node process report reports no glibc runtime (musl-built node)',
      };
    }
  } catch {
    // process.report may be unavailable on some Node builds; fall through.
  }

  const readFile =
    io.readFile ??
    ((p: string) => {
      try {
        return readFileSync(p, 'utf8');
      } catch {
        return undefined;
      }
    });
  const osRelease = readFile('/etc/os-release');
  if (osRelease && /^ID(_LIKE)?=.*alpine/im.test(osRelease)) {
    return { isMusl: true, reason: 'detected Alpine via /etc/os-release' };
  }

  const exists = io.exists ?? existsSync;
  if (exists('/lib/ld-musl-x86_64.so.1') || exists('/lib/ld-musl-aarch64.so.1')) {
    return { isMusl: true, reason: 'found musl dynamic loader on disk' };
  }

  return { isMusl: false };
}
