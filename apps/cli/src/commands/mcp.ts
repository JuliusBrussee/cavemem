import type { Command } from 'commander';

export function registerMcpCommand(program: Command): void {
  program
    .command('mcp')
    .description('Start the MCP stdio server (for IDE integration)')
    .action(async () => {
      const { main } = await import('@cavemem/mcp-server');
      await main();
    });
}