export interface InstallContext {
  /** Directory where the IDE keeps its config. */
  ideConfigDir: string;
  /** Absolute path to the cavemem CLI entrypoint (the .js file). */
  cliPath: string;
  /**
   * Absolute path to the Node binary used to launch the CLI. IDE configs
   * must spawn `nodeBin cliPath …`, not `cliPath …` — on Windows spawning
   * a raw .js fails with EFTYPE (no associated exec handler).
   */
  nodeBin: string;
  /** Absolute path to the local data dir (e.g., ~/.cavemem). */
  dataDir: string;
}

/**
 * Whether installing cavemem for this IDE wires up observation capture
 * (hooks fire, DB fills) or only exposes MCP query access over memory
 * captured elsewhere. See #58 — this is surfaced in `cavemem status` and
 * the README capability matrix so users aren't surprised an IDE never
 * records anything.
 */
export type CaptureLevel = 'full' | 'partial' | 'none';

export interface Installer {
  id: string;
  label: string;
  /** Capture coverage this IDE gets from `install()`. See {@link CaptureLevel}. */
  capture: CaptureLevel;
  /** Human-readable caveat about capture coverage, e.g. "no SessionEnd event". */
  captureNotes?: string;
  detect(ctx: InstallContext): Promise<boolean>;
  install(ctx: InstallContext): Promise<string[]>;
  uninstall(ctx: InstallContext): Promise<string[]>;
}
