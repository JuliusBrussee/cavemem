import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { compress, countTokens, expand } from '@cavemem/compress';
import { loadSettings } from '@cavemem/config';
import type { Command } from 'commander';
import kleur from 'kleur';

export function registerCompressCommands(program: Command): void {
  program
    .command('compress <file>')
    .description('Compress a file in place (.original backup created)')
    .option('--intensity <level>', 'lite | full | ultra')
    .action(async (file: string, opts: { intensity?: 'lite' | 'full' | 'ultra' }) => {
      const text = readFileSync(file, 'utf8');
      const intensity = opts.intensity ?? loadSettings().compression.intensity;
      copyFileSync(file, `${file}.original`);
      const out = compress(text, { intensity });
      writeFileSync(file, out, 'utf8');
      const saved = Math.round(((countTokens(text) - countTokens(out)) / countTokens(text)) * 100);
      process.stdout.write(
        `${kleur.green('✓')} compressed ${file} (≈${saved}% fewer tokens). Backup at ${file}.original\n`,
      );
    });

  program
    .command('expand <file>')
    .description('Expand abbreviations in a file')
    .action(async (file: string) => {
      const text = readFileSync(file, 'utf8');
      writeFileSync(file, expand(text), 'utf8');
      process.stdout.write(`${kleur.green('✓')} expanded ${file}\n`);
    });
}
