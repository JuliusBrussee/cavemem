import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  defaultSettings,
  loadSettings,
  resolveDataDir,
  saveSettings,
  settingsPath,
} from '@cavemem/config';
import { type IdeName, getInstaller, installers } from '@cavemem/installers';
import type { Command } from 'commander';
import kleur from 'kleur';
import { resolveCliPath } from '../util/resolve.js';

export function registerInstallCommand(program: Command): void {
  program
    .command('install')
    .description('Register hooks + MCP server for an IDE')
    .option('--ide <name>', 'IDE to target', 'claude-code')
    .action(async (opts: { ide: string }) => {
      const name = opts.ide as IdeName;
      if (!installers[name]) {
        throw new Error(
          `Unknown --ide ${opts.ide}. Choices: ${Object.keys(installers).join(', ')}`,
        );
      }
      const path = settingsPath();
      if (!existsSync(path)) {
        saveSettings(defaultSettings);
        process.stdout.write(`wrote ${path}\n`);
      }
      const settings = loadSettings();
      const ctx = {
        ideConfigDir: homedir(),
        cliPath: resolveCliPath(),
        dataDir: resolveDataDir(settings.dataDir),
      };
      const installer = getInstaller(name);
      const msgs = await installer.install(ctx);
      for (const m of msgs) process.stdout.write(`${kleur.green('✓')} ${m}\n`);
      settings.ides[name] = true;
      saveSettings(settings);
      process.stdout.write(`\n${kleur.bold('next:')} run ${kleur.cyan('cavemem doctor')}\n`);
    });
}
