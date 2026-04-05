# Snowcode

Snowcode is a multi-provider coding CLI.

## CLI

Install globally from npm:

```bash
npm install -g snowcode
snowcode
```

For local development from this repo:

```bash
bun run build
node dist/cli.mjs
```

Useful scripts:

```bash
npm run install:global
npm run link:global
npm run unlink:global
```

## Release

- Push tags like `v0.9.1` to trigger the npm publish workflow.
- Set `NPM_TOKEN` in GitHub repository secrets before using the workflow.
