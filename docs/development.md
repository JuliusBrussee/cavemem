# Development

## Prereqs

- Node ≥ 20
- pnpm ≥ 9

## Setup

```bash
pnpm install
pnpm build
```

Link the CLI for local use:

```bash
cd apps/cli && pnpm link --global
cavemem --help
```

## Run against a scratch data dir

`CAVEMEM_HOME` overrides where cavemem stores settings.json, data.db, and all
other state (see `@cavemem/config`'s `resolveCavememHome`) — point it at a
repo-local scratch dir so dev runs never touch `~/.cavemem`:

```bash
export CAVEMEM_HOME=$PWD/.cavemem-dev
pnpm dev
```

## Gates

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

All four must pass before merging.

## Adding a changeset

```bash
pnpm changeset
```

Commit the generated file with your PR.
