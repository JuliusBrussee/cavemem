import { type HookName, runHook } from '@cavemem/hooks';
import type { Command } from 'commander';

const VALID: HookName[] = [
  'session-start',
  'user-prompt-submit',
  'post-tool-use',
  'stop',
  'session-end',
];

export function registerHookCommand(program: Command): void {
  const hook = program.command('hook').description('Internal: hook handler entrypoints');
  hook
    .command('run <name>')
    .description('Run a hook by name (reads JSON from stdin)')
    .action(async (name: string) => {
      if (!VALID.includes(name as HookName)) {
        throw new Error(`Unknown hook ${name}. Valid: ${VALID.join(', ')}`);
      }
      const raw = await readStdin();
      const input = raw.trim() ? JSON.parse(raw) : {};
      const result = await runHook(name as HookName, input);
      process.stdout.write(`${JSON.stringify(result)}\n`);
      if (!result.ok) process.exitCode = 1;
    });
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) {
      resolve('');
      return;
    }
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
  });
}
