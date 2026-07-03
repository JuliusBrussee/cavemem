import { antigravity } from './antigravity.js';
import { augment } from './augment.js';
import { bob } from './bob.js';
import { claudeCode } from './claude-code.js';
import { codex } from './codex.js';
import { copilot } from './copilot.js';
import { cursor } from './cursor.js';
import { geminiCli } from './gemini-cli.js';
import { openCode } from './opencode.js';
import type { Installer } from './types.js';

export type IdeName =
  | 'claude-code'
  | 'gemini-cli'
  | 'opencode'
  | 'codex'
  | 'cursor'
  | 'copilot'
  | 'augment'
  | 'antigravity'
  | 'bob';

export const installers: Record<IdeName, Installer> = {
  'claude-code': claudeCode,
  'gemini-cli': geminiCli,
  opencode: openCode,
  codex,
  cursor,
  copilot,
  augment,
  antigravity,
  bob,
};

export function getInstaller(name: string): Installer {
  const found = installers[name as IdeName];
  if (!found) throw new Error(`Unknown IDE: ${name}. Known: ${Object.keys(installers).join(', ')}`);
  return found;
}

export type { Installer, InstallContext } from './types.js';
