import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  coerceReasoningEffort,
  resolveCodexApiCredentialsForRequest,
  resolveProviderRequest,
} from './providerConfig.js'

const tempDirs: string[] = []
const originalFetch = globalThis.fetch
const originalSnowcodeConfigDir = process.env.SNOWCODE_CONFIG_DIR

afterEach(() => {
  globalThis.fetch = originalFetch
  if (originalSnowcodeConfigDir === undefined) {
    delete process.env.SNOWCODE_CONFIG_DIR
  } else {
    process.env.SNOWCODE_CONFIG_DIR = originalSnowcodeConfigDir
  }

  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function createJwt(payload: Record<string, unknown>): string {
  const encode = (value: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode(payload)}.sig`
}

test('codex provider prefix routes codex-plan through responses transport', () => {
  const resolved = resolveProviderRequest({ model: 'codex:codex-plan' })

  expect(resolved.transport).toBe('codex_responses')
  expect(resolved.resolvedModel).toBe('gpt-5.4')
  expect(resolved.reasoning).toEqual({ effort: 'high' })
})

test('vertex provider prefix forces vertex transport even for Claude models', () => {
  const resolved = resolveProviderRequest({ model: 'vertex:claude-sonnet-4-6' })

  expect(resolved.transport).toBe('vertex_generate_content')
  expect(resolved.baseUrl).toBe('https://aiplatform.googleapis.com/v1')
  expect(resolved.resolvedModel).toBe('claude-sonnet-4-6')
})

test('runtime effort override beats model defaults for openai-prefixed models', () => {
  const resolved = resolveProviderRequest({
    model: 'openai:gpt-5.4?reasoning=high',
    effort: 'medium',
  })

  expect(resolved.transport).toBe('chat_completions')
  expect(resolved.resolvedModel).toBe('gpt-5.4')
  expect(resolved.reasoning).toEqual({ effort: 'medium' })
})

test('max effort coerces down to high for third-party reasoning backends', () => {
  expect(coerceReasoningEffort('max')).toBe('high')
})

test('refreshes expired Codex auth.json tokens before returning request credentials', async () => {
  const authDir = createTempDir('snowcode-codex-auth-')
  const authPath = join(authDir, 'auth.json')
  const expiredToken = createJwt({
    exp: Math.floor(Date.now() / 1000) - 3600,
    'https://api.openai.com/auth.chatgpt_account_id': 'acct_old',
  })
  const freshToken = createJwt({
    exp: Math.floor(Date.now() / 1000) + 3600,
    'https://api.openai.com/auth.chatgpt_account_id': 'acct_fresh',
  })

  writeFileSync(
    authPath,
    JSON.stringify({
      tokens: {
        access_token: expiredToken,
        refresh_token: 'refresh-old',
        account_id: 'acct_old',
      },
    }),
    'utf8',
  )

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    expect(String(input)).toBe('https://auth.openai.com/oauth/token')
    return new Response(
      JSON.stringify({
        access_token: freshToken,
        refresh_token: 'refresh-new',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  }) as typeof fetch

  const credentials = await resolveCodexApiCredentialsForRequest({
    CODEX_AUTH_JSON_PATH: authPath,
  } as NodeJS.ProcessEnv)

  expect(credentials.apiKey).toBe(freshToken)
  expect(credentials.accountId).toBe('acct_fresh')
  expect(credentials.refreshToken).toBe('refresh-new')
  expect(credentials.source).toBe('auth.json')

  const persisted = JSON.parse(readFileSync(authPath, 'utf8')) as {
    access_token?: string
    refresh_token?: string
    account_id?: string
    tokens?: {
      access_token?: string
      refresh_token?: string
      account_id?: string
    }
  }
  expect(persisted.access_token).toBe(freshToken)
  expect(persisted.refresh_token).toBe('refresh-new')
  expect(persisted.account_id).toBe('acct_fresh')
  expect(persisted.tokens?.access_token).toBe(freshToken)
  expect(persisted.tokens?.refresh_token).toBe('refresh-new')
  expect(persisted.tokens?.account_id).toBe('acct_fresh')
})

test('falls back to the newest enabled codex_oauth account when auth.json is missing', async () => {
  const authDir = createTempDir('snowcode-codex-auth-')
  const configDir = createTempDir('snowcode-cfg-')
  const authPath = join(authDir, 'auth.json')
  process.env.SNOWCODE_CONFIG_DIR = configDir
  mkdirSync(configDir, { recursive: true })
  writeFileSync(
    join(configDir, 'accounts.json'),
    JSON.stringify(
      {
        version: 1,
        accounts: [
          {
            id: 'older',
            type: 'codex_oauth',
            label: 'Codex older',
            enabled: true,
            refreshToken: 'refresh-older',
            email: 'older@example.com',
            addedAt: '2026-01-01T00:00:00.000Z',
          },
          {
            id: 'latest',
            type: 'codex_oauth',
            label: 'Codex latest',
            enabled: true,
            refreshToken: 'refresh-latest',
            email: 'latest@example.com',
            addedAt: '2026-04-05T00:00:00.000Z',
          },
        ],
      },
      null,
      2,
    ),
    'utf8',
  )

  const freshToken = createJwt({
    exp: Math.floor(Date.now() / 1000) + 3600,
    'https://api.openai.com/auth.chatgpt_account_id': 'acct_from_refresh',
  })

  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = String(init?.body ?? '')
    expect(body).toContain('refresh_token=refresh-latest')
    return new Response(
      JSON.stringify({
        access_token: freshToken,
        refresh_token: 'refresh-rotated',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  }) as typeof fetch

  const credentials = await resolveCodexApiCredentialsForRequest({
    CODEX_AUTH_JSON_PATH: authPath,
  } as NodeJS.ProcessEnv)

  expect(credentials.apiKey).toBe(freshToken)
  expect(credentials.accountId).toBe('acct_from_refresh')
  expect(credentials.refreshToken).toBe('refresh-rotated')
  expect(credentials.accountRecordId).toBe('latest')
  expect(credentials.source).toBe('accounts')

  const persistedAuth = JSON.parse(readFileSync(authPath, 'utf8')) as {
    access_token?: string
    refresh_token?: string
    account_id?: string
  }
  expect(persistedAuth.access_token).toBe(freshToken)
  expect(persistedAuth.refresh_token).toBe('refresh-rotated')
  expect(persistedAuth.account_id).toBe('acct_from_refresh')

  const persistedAccounts = JSON.parse(
    readFileSync(join(configDir, 'accounts.json'), 'utf8'),
  ) as {
    accounts: Array<{ id: string; refreshToken?: string }>
  }
  expect(
    persistedAccounts.accounts.find(account => account.id === 'latest')
      ?.refreshToken,
  ).toBe('refresh-rotated')
})
