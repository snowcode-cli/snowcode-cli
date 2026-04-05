# SNOW.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development commands

- Install dependencies: `bun install`  
  - CI uses `bun install --frozen-lockfile`.
- Build the CLI bundle: `bun run build`
- Run the built CLI locally: `node dist/cli.mjs`
- Build and launch in one step: `bun run dev`
- Smoke-check the distributable: `bun run smoke`
- Typecheck: `bun run typecheck`  
  - There is no dedicated lint script in `package.json`; `typecheck` is the main static check.
- Run the provider-focused test suite used in CI: `bun run test:provider`
- Run provider recommendation tests: `npm run test:provider-recommendation`
- Run a single test file directly with Bun: `bun test src/utils/providerRecommendation.test.ts`
- Run multiple targeted tests directly: `bun test path/to/test1.test.ts path/to/test2.test.ts`

Useful local launchers for provider-specific development:

- `bun run dev:codex`
- `bun run dev:openai`
- `bun run dev:gemini`
- `bun run dev:ollama`
- `bun run dev:vertex`

CI expectations from `.github/workflows/pr-checks.yml`:

- Node.js 22
- Bun 1.3.11
- Checks run: `bun run smoke`, `bun run test:provider`, `npm run test:provider-recommendation`

## High-level architecture

### Runtime shape

- `scripts/build.ts` bundles `src/entrypoints/cli.tsx` into `dist/cli.mjs`.
- The build is an **open build**: many Anthropic-internal features are hard-disabled at bundle time via `feature('...')` and shim modules. Code may exist in the tree but be dead-code-eliminated from the shipped bundle.
- `src/entrypoints/cli.tsx` is the lightweight bootstrap layer. It handles early env validation, version fast-paths, a few special startup modes, prints the startup screen, and only then loads the full app.
- `src/main.tsx` is the central startup/orchestration file. It initializes config, auth, telemetry, permissions, MCP, plugins, session restore, worktree/sandbox state, then launches the Ink/React REPL.

### Command / tool / skill model

- Slash commands are registered in `src/commands.ts`; implementations live under `src/commands/*`.
- `src/commands.ts` is the quickest way to answer:
  - which commands are user-facing,
  - which are internal-only,
  - which are gated behind `feature()` flags.
- Tools are registered in `src/tools.ts`. This is the main permission surface and registry for Bash/File/Task/Plan/Worktree/MCP/etc.
- Bundled skills are registered programmatically in `src/skills/bundledSkills.ts`. Bundled skills can lazily extract reference files to disk for later `Read`/`Grep` access.

When adding a new user capability, check whether it needs wiring in more than one place:

- command registry (`src/commands.ts`)
- tool registry (`src/tools.ts`)
- bundled skill registration (`src/skills/*`)
- feature gating / open-build behavior (`feature()` in build + runtime)

### Provider and model abstraction

- Snowcode is provider-scoped and config-first. Models use the `provider:model` format described in `README.md`.
- `src/services/api/providerConfig.ts` is the key provider-routing layer. It:
  - normalizes provider-scoped model strings,
  - resolves aliases like `codexplan`,
  - chooses transport (`chat_completions`, `codex_responses`, `vertex_generate_content`, `antigravity_generate_content`),
  - resolves auth/base URLs from env, `auth.json`, and account storage.
- If behavior differs across Codex/OpenAI/Gemini/Vertex/etc., start in `providerConfig.ts` before tracing individual API clients.

### Settings and config resolution

- The repo follows a config-first model.
- Per `README.md`, user state lives in `~/.snowcode/` and project overrides can live in:
  - `.claude/settings.json`
  - `.claude/settings.local.json`
- `src/utils/settings/settings.ts` is the core settings loader/merger. It handles multiple sources, caching, validation, and managed/admin settings.
- Managed settings are not just one file: the loader supports a base `managed-settings.json` plus drop-ins in `managed-settings.d/*.json`, merged in lexical order.

If a setting appears to come from “nowhere”, inspect `settings.ts` and the enabled setting sources before changing command logic.

### Remote sessions, persistence, and MCP

- Remote/teleport/session-resume flows are orchestrated from `src/main.tsx`, with supporting logic under `src/utils/teleport.tsx`, `src/utils/teleport.ts`, and `src/utils/teleport/api.ts`.
- `src/services/api/sessionIngress.ts` handles remote transcript persistence. It uses per-session sequential writes plus optimistic concurrency (`Last-Uuid`) to recover from stale or concurrent writers.
- MCP is a first-class subsystem, loaded during startup from `src/services/mcp/*` and exposed through both command and tool registration.

If you are changing resume, remote sync, or session hydration behavior, check `sessionIngress.ts` and the teleport helpers together; they are part of the same flow.

### Plugins and startup extensibility

- Plugin and bundled-skill initialization happens during startup in `src/main.tsx`.
- The app loads bundled plugins, versioned plugins, dynamic skills, and MCP-provided capabilities as part of the REPL environment rather than treating them as separate subsystems.
- Because of that, many “missing command/tool” bugs are actually startup registration or settings/permission issues, not implementation bugs in the command itself.

## Practical reading order

For most changes, avoid starting with the full `src/main.tsx` file unless necessary. A faster orientation path is:

1. `package.json` — scripts / entrypoints
2. `src/entrypoints/cli.tsx` — bootstrap behavior
3. `src/commands.ts` — command surface
4. `src/tools.ts` — tool surface
5. `src/services/api/providerConfig.ts` — provider routing
6. `src/utils/settings/settings.ts` — settings resolution
7. `src/main.tsx` — full runtime orchestration
