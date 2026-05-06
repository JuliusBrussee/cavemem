import type { Command } from 'commander';

export function registerMcpCommand(program: Command): void {
  program
    .command('mcp')
    .description('Run the MCP stdio server (typically invoked by the IDE)')
    .action(async () => {
      // The server module guards `main()` behind an `isMainEntry()` check, so
      // a bare dynamic import does not start the stdio server when invoked
      // through the CLI. Pull `main` out and call it explicitly.
      const { main } = await import('@cavemem/mcp-server');
      await main();
    });
}
