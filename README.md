# Snowcode

Snowcode is a multi-provider coding CLI focused on real coding workflows, provider switching, and config-first setup.

It keeps the Claude Code style terminal experience, but lets you use other providers and models such as Codex/OpenAI, Anthropic, Gemini, Vertex, Ollama, and Z.AI.

## Install

```bash
npm install -g snowcode
```

After install, both commands are available:

```bash
snowcode
snowcode-dev
```

## Quick Start

1. Start the CLI:

```bash
snowcode
```

2. Add an account:

```text
/auth
```

3. Pick a model:

```text
/model
```

4. Start coding in the current folder.

## Model Format

Snowcode supports provider-scoped model names in the format:

```text
provider:model
```

Examples:

```text
codex:gpt-5.4
codex:gpt-5.1-codex-mini
anthropic:claude-sonnet-4-6
vertex:claude-sonnet-4-6
antigravity:gemini-3.1-pro
zai:glm-4.5
```

The provider decides transport, auth, endpoint, and provider-specific request formatting.

## Config Files

Snowcode stores user data in `~/.snowcode/`.

Common files:

- `~/.snowcode/settings.json` — user settings
- `~/.snowcode/accounts.json` — authenticated provider accounts
- `~/.snowcode/models.json` — custom model list / provider model definitions

Project-specific settings can also live in:

- `.claude/settings.json`
- `.claude/settings.local.json`

## Example Settings

```json
{
  "model": "codex:gpt-5.4",
  "compactModel": "openai:gpt-4o-mini",
  "autoCompactWindowTokens": 120000
}
```

## Useful Commands

- `/auth` — add or manage provider accounts
- `/model` — switch models
- `/effort`, `/reasoning`, `/thinking` — provider/model-specific inference controls
- `/compact` — compact conversation context
- `/usage` — inspect provider usage pages
- `/config` — inspect or update settings

## Local Development

```bash
bun install
bun run build
node dist/cli.mjs
```

Useful scripts:

```bash
npm run install:global
npm run link:global
npm run unlink:global
bun run test:provider
bun run build
```

## Notes

- `/login` is kept as an alias for `/auth`.
- Codex auth can refresh from the Snowcode account store when the local Codex token is stale.
- The main documentation flow is config-first. Prefer `settings.json` and `/config` over ad-hoc env setup.
