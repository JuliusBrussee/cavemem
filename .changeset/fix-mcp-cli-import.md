---
"cavemem": patch
"@cavemem/mcp-server": patch
---

fix(mcp): boot stdio server when invoked via `cavemem mcp`

The CLI's `mcp` subcommand did `await import('@cavemem/mcp-server')` expecting
the import side-effect to start the server, but the server module guards
`main()` behind an `isMainEntry()` check. When dynamically imported,
`import.meta.url` does not match `process.argv[1]` (the CLI), so `main()`
never ran and no MCP tools were exposed to the host IDE. Export `main()` from
the server module and have the CLI call it explicitly. The `isMainEntry()`
guard remains so the `cavemem-mcp` bin still works when invoked directly.
