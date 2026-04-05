import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { loadAccounts } from '../../utils/accountManager.js'
import type { AccountType } from '../../utils/accountManager.js'
import { assertAntigravityOAuthConfig } from '../../utils/antigravityOAuth.js'
import {
  type ModelProviderPrefix,
  getModelProviderPrefix,
  getProviderScopedBaseModel,
  stripModelProviderPrefix,
} from '../../utils/model/providerMetadata.js'

export const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1'
export const DEFAULT_CODEX_BASE_URL = 'https://chatgpt.com/backend-api/codex'
export const DEFAULT_VERTEX_BASE_URL = 'https://aiplatform.googleapis.com/v1'
export const DEFAULT_ANTIGRAVITY_BASE_URL =
  'https://daily-cloudcode-pa.googleapis.com'
const ANTIGRAVITY_FALLBACK_BASE_URLS = [
  'https://daily-cloudcode-pa.googleapis.com',
  'https://cloudcode-pa.googleapis.com',
  'https://autopush-cloudcode-pa.sandbox.googleapis.com',
  'https://daily-cloudcode-pa.sandbox.googleapis.com',
] as const
export const DEFAULT_GEMINI_OPENAI_BASE_URL =
  'https://generativelanguage.googleapis.com/v1beta/openai'
export const DEFAULT_ZAI_BASE_URL = 'https://api.z.ai/api/paas/v4'
export const ANTIGRAVITY_DEFAULT_PROJECT_ID = 'rising-fact-p41fc'
const GOOGLE_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token'

const CODEX_ALIAS_MODELS: Record<
  string,
  {
    model: string
    reasoningEffort?: ReasoningEffort
  }
> = {
  codexplan: {
    model: 'gpt-5.4',
    reasoningEffort: 'high',
  },
  'codex-plan': {
    model: 'gpt-5.4',
    reasoningEffort: 'high',
  },
  codexspark: {
    model: 'gpt-5.3-codex-spark',
  },
  'codex-spark': {
    model: 'gpt-5.3-codex-spark',
  },
} as const

type CodexAlias = keyof typeof CODEX_ALIAS_MODELS
export type ReasoningEffort = 'low' | 'medium' | 'high'

export type ProviderTransport =
  | 'chat_completions'
  | 'codex_responses'
  | 'vertex_generate_content'
  | 'antigravity_generate_content'

export type ResolvedProviderRequest = {
  transport: ProviderTransport
  providerPrefix?: ModelProviderPrefix
  requestedModel: string
  resolvedModel: string
  baseUrl: string
  reasoning?: {
    effort: ReasoningEffort
  }
}

export type ResolvedCodexCredentials = {
  apiKey: string
  accountId?: string
  authPath?: string
  source: 'env' | 'auth.json' | 'none'
}

export type ResolvedAntigravityAuth = {
  accessToken: string
  projectId?: string
  managedProjectId?: string
  baseUrl?: string
}

type ModelDescriptor = {
  raw: string
  baseModel: string
  reasoning?: {
    effort: ReasoningEffort
  }
}

const LOCALHOST_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1'])

function asTrimmedString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function readNestedString(
  value: unknown,
  paths: string[][],
): string | undefined {
  for (const path of paths) {
    let current = value
    let valid = true
    for (const key of path) {
      if (!current || typeof current !== 'object' || !(key in current)) {
        valid = false
        break
      }
      current = (current as Record<string, unknown>)[key]
    }
    if (!valid) continue
    const stringValue = asTrimmedString(current)
    if (stringValue) return stringValue
  }
  return undefined
}

function decodeJwtPayload(token: string): Record<string, unknown> | undefined {
  const parts = token.split('.')
  if (parts.length < 2) return undefined

  try {
    const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
    const json = Buffer.from(padded, 'base64').toString('utf8')
    const parsed = JSON.parse(json)
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : undefined
  } catch {
    return undefined
  }
}

function parseReasoningEffort(value: string | undefined): ReasoningEffort | undefined {
  if (!value) return undefined
  const normalized = value.trim().toLowerCase()
  if (normalized === 'low' || normalized === 'medium' || normalized === 'high') {
    return normalized
  }
  return undefined
}

export function coerceReasoningEffort(value: unknown): ReasoningEffort | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value <= 50) return 'low'
    if (value <= 85) return 'medium'
    return 'high'
  }

  if (typeof value !== 'string') return undefined

  const normalized = value.trim().toLowerCase()
  if (normalized === 'max') {
    return 'high'
  }

  return parseReasoningEffort(normalized)
}

function parseModelDescriptor(model: string): ModelDescriptor {
  const trimmed = stripModelProviderPrefix(model.trim())
  const queryIndex = trimmed.indexOf('?')
  if (queryIndex === -1) {
    const alias = trimmed.toLowerCase() as CodexAlias
    const aliasConfig = CODEX_ALIAS_MODELS[alias]
    if (aliasConfig) {
      return {
        raw: trimmed,
        baseModel: aliasConfig.model,
        reasoning: aliasConfig.reasoningEffort
          ? { effort: aliasConfig.reasoningEffort }
          : undefined,
      }
    }
    return {
      raw: trimmed,
      baseModel: trimmed,
    }
  }

  const baseModel = trimmed.slice(0, queryIndex).trim()
  const params = new URLSearchParams(trimmed.slice(queryIndex + 1))
  const alias = baseModel.toLowerCase() as CodexAlias
  const aliasConfig = CODEX_ALIAS_MODELS[alias]
  const resolvedBaseModel = aliasConfig?.model ?? baseModel
  const reasoning =
    parseReasoningEffort(params.get('reasoning') ?? undefined) ??
    (aliasConfig?.reasoningEffort
      ? { effort: aliasConfig.reasoningEffort }
      : undefined)

  return {
    raw: trimmed,
    baseModel: resolvedBaseModel,
    reasoning: typeof reasoning === 'string' ? { effort: reasoning } : reasoning,
  }
}

export function isCodexAlias(model: string): boolean {
  const base = getProviderScopedBaseModel(model).toLowerCase()
  return base in CODEX_ALIAS_MODELS
}

export function isLocalProviderUrl(baseUrl: string | undefined): boolean {
  if (!baseUrl) return false
  try {
    return LOCALHOST_HOSTNAMES.has(new URL(baseUrl).hostname)
  } catch {
    return false
  }
}

export function isCodexBaseUrl(baseUrl: string | undefined): boolean {
  if (!baseUrl) return false
  try {
    const parsed = new URL(baseUrl)
    return (
      parsed.hostname === 'chatgpt.com' &&
      parsed.pathname.replace(/\/+$/, '') === '/backend-api/codex'
    )
  } catch {
    return false
  }
}

export function isVertexBaseUrl(baseUrl: string | undefined): boolean {
  if (!baseUrl) return false
  try {
    const parsed = new URL(baseUrl)
    return (
      parsed.hostname === 'aiplatform.googleapis.com' &&
      parsed.pathname.replace(/\/+$/, '') === '/v1'
    )
  } catch {
    return false
  }
}

function isVertexModel(model: string): boolean {
  const normalized = getProviderScopedBaseModel(model).toLowerCase()
  return normalized.startsWith('gemini-')
}

/** Maps model prefix → account type in accounts.json */
const PREFIX_TO_ACCOUNT_TYPE: Record<string, AccountType> = {
  vertex: 'vertex_api',
  google: 'google_oauth',
  openai: 'openai_api',
  codex: 'openai_api',
  zai: 'zhipu_api',
  antigravity: 'google_oauth',
  gemini: 'gemini_api',
}

/** Extract the provider prefix from a model string (e.g. "vertex" from "vertex:gemini-3.1-pro-preview") */
export function getModelPrefix(model: string): string | undefined {
  const prefix = getModelProviderPrefix(model)
  return prefix && Object.prototype.hasOwnProperty.call(PREFIX_TO_ACCOUNT_TYPE, prefix)
    ? prefix
    : undefined
}

/** Returns true if the model has a non-anthropic provider prefix */
export function isThirdPartyModel(model: string): boolean {
  const prefix = getModelPrefix(model)
  return prefix != null && prefix !== 'anthropic'
}

/**
 * Resolve the API key for a model by looking up the matching account in accounts.json.
 * Falls back to undefined if no account found (caller can fallback to env vars).
 */
export function resolveApiKeyFromAccounts(model: string): string | undefined {
  const prefix = getModelPrefix(model)
  if (!prefix) return undefined
  const accountType = PREFIX_TO_ACCOUNT_TYPE[prefix]
  if (!accountType) return undefined
  try {
    const accounts = loadAccounts()
    const account = accounts.accounts.find(a => a.enabled && a.type === accountType && a.apiKey)
    return account?.apiKey
  } catch {
    return undefined
  }
}

function parseStoredAntigravityRefresh(value: string | undefined): {
  refreshToken: string
  projectId?: string
  managedProjectId?: string
} | undefined {
  const raw = asTrimmedString(value)
  if (!raw) return undefined
  const [refreshToken = '', projectId = '', managedProjectId = ''] = raw.split('|')
  const trimmedRefresh = refreshToken.trim()
  if (!trimmedRefresh) return undefined
  return {
    refreshToken: trimmedRefresh,
    projectId: asTrimmedString(projectId),
    managedProjectId: asTrimmedString(managedProjectId),
  }
}

function getPreferredGoogleOauthAccount(
  accounts: ReturnType<typeof loadAccounts>['accounts'],
) {
  return [...accounts]
    .filter(
      account => account.enabled && account.type === 'google_oauth' && account.refreshToken,
    )
    .sort((left, right) => {
      const leftStored = parseStoredAntigravityRefresh(left.refreshToken)
      const rightStored = parseStoredAntigravityRefresh(right.refreshToken)

      const leftHasProject = Boolean(leftStored?.projectId || leftStored?.managedProjectId || left.projectId)
      const rightHasProject = Boolean(
        rightStored?.projectId || rightStored?.managedProjectId || right.projectId,
      )
      if (leftHasProject !== rightHasProject) {
        return rightHasProject ? 1 : -1
      }

      const leftAddedAt = Date.parse(left.addedAt || '')
      const rightAddedAt = Date.parse(right.addedAt || '')
      return rightAddedAt - leftAddedAt
    })[0]
}

async function refreshGoogleAccessToken(
  refreshToken: string,
): Promise<string | undefined> {
  try {
    const oauth = assertAntigravityOAuthConfig()
    const response = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: oauth.clientId,
        client_secret: oauth.clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }).toString(),
    })
    if (!response.ok) return undefined
    const json = (await response.json()) as { access_token?: string }
    return asTrimmedString(json.access_token)
  } catch {
    return undefined
  }
}

async function resolveManagedProjectId(
  accessToken: string,
  projectId?: string,
): Promise<{ managedProjectId?: string; baseUrl?: string }> {
  const metadata: Record<string, string> = {
    ideType: 'ANTIGRAVITY',
    platform: 'WINDOWS',
    pluginType: 'GEMINI',
  }
  if (projectId) {
    metadata.duetProject = projectId
  }

  for (const baseUrl of ANTIGRAVITY_FALLBACK_BASE_URLS) {
    const response = await fetch(
      `${baseUrl}/v1internal:loadCodeAssist`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
          'User-Agent': 'google-api-nodejs-client/9.15.1',
          'X-Goog-Api-Client': 'google-cloud-sdk vscode_cloudshelleditor/0.1',
          'Client-Metadata': `{"ideType":"ANTIGRAVITY","platform":"WINDOWS","pluginType":"GEMINI"}`,
        },
        body: JSON.stringify({ metadata }),
      },
    ).catch(() => undefined)

    if (!response?.ok) continue
    const data = (await response.json()) as {
      cloudaicompanionProject?: string | { id?: string }
      allowedTiers?: Array<{ id?: string; isDefault?: boolean }>
    }
    if (typeof data.cloudaicompanionProject === 'string') {
      return {
        managedProjectId: asTrimmedString(data.cloudaicompanionProject),
        baseUrl,
      }
    }
    const managedProjectId = asTrimmedString(data.cloudaicompanionProject?.id)
    if (managedProjectId) {
      return {
        managedProjectId,
        baseUrl,
      }
    }

    const tierId =
      data.allowedTiers?.find(tier => tier?.isDefault)?.id ??
      data.allowedTiers?.[0]?.id ??
      'FREE'

    const onboardResponse = await fetch(
      `${baseUrl}/v1internal:onboardUser`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
          'User-Agent': 'google-api-nodejs-client/9.15.1',
          'X-Goog-Api-Client': 'google-cloud-sdk vscode_cloudshelleditor/0.1',
          'Client-Metadata': `{"ideType":"ANTIGRAVITY","platform":"WINDOWS","pluginType":"GEMINI"}`,
        },
        body: JSON.stringify({ tierId, metadata }),
      },
    ).catch(() => undefined)

    if (!onboardResponse?.ok) continue
    const onboardData = (await onboardResponse.json()) as {
      done?: boolean
      response?: {
        cloudaicompanionProject?: { id?: string }
      }
    }
    const onboardedProjectId = asTrimmedString(
      onboardData.response?.cloudaicompanionProject?.id,
    )
    if (onboardData.done && onboardedProjectId) {
      return {
        managedProjectId: onboardedProjectId,
        baseUrl,
      }
    }
  }

  return {}
}

export async function resolveApiKeyForModel(
  model: string,
): Promise<string | undefined> {
  const prefix = getModelPrefix(model)
  if (!prefix) return undefined
  const accountType = PREFIX_TO_ACCOUNT_TYPE[prefix]
  if (!accountType) return undefined

  try {
    const accounts = loadAccounts()
    const account = accounts.accounts.find(a => a.enabled && a.type === accountType)
    if (!account) return undefined

    if (account.apiKey) return account.apiKey

    if (accountType === 'google_oauth' && account.refreshToken) {
      return await refreshGoogleAccessToken(account.refreshToken)
    }

    return undefined
  } catch {
    return undefined
  }
}

export async function resolveAntigravityAuthForModel(
  model: string,
): Promise<ResolvedAntigravityAuth | undefined> {
  const prefix = getModelPrefix(model)
  if (prefix !== 'antigravity' && prefix !== 'google') return undefined

  try {
    const accounts = loadAccounts()
    const account = getPreferredGoogleOauthAccount(accounts.accounts)
    if (!account?.refreshToken) return undefined

    const stored = parseStoredAntigravityRefresh(account.refreshToken)
    if (!stored) return undefined
    const projectId = asTrimmedString(account.projectId) ?? stored.projectId

    const accessToken = await refreshGoogleAccessToken(stored.refreshToken)
    if (!accessToken) return undefined

    const resolvedManagedContext = await resolveManagedProjectId(
      accessToken,
      projectId,
    )
    const managedProjectId =
      stored.managedProjectId ?? resolvedManagedContext.managedProjectId

    return {
      accessToken,
      projectId,
      managedProjectId,
      baseUrl: resolvedManagedContext.baseUrl,
    }
  } catch {
    return undefined
  }
}

export function resolveProviderRequest(options?: {
  model?: string
  baseUrl?: string
  fallbackModel?: string
  effort?: unknown
  apiKey?: string
}): ResolvedProviderRequest {
  const requestedModel =
    options?.model?.trim() ||
    process.env.OPENAI_MODEL?.trim() ||
    options?.fallbackModel?.trim() ||
    'gpt-4o'
  const descriptor = parseModelDescriptor(requestedModel)
  // Guard against the literal string "undefined" that shells or misconfigured
  // env passthrough can produce (e.g. OPENAI_BASE_URL=undefined).
  const asEnvUrl = (v: string | undefined): string | undefined =>
    v === 'undefined' || v === '' ? undefined : v
  const rawBaseUrl =
    options?.baseUrl ??
    asEnvUrl(process.env.OPENAI_BASE_URL) ??
    asEnvUrl(process.env.OPENAI_API_BASE) ??
    undefined
  const modelPrefix = getModelPrefix(requestedModel)
  const providerPrefix = getModelProviderPrefix(requestedModel)
  const reasoningEffort = coerceReasoningEffort(options?.effort)
  const reasoning = reasoningEffort
    ? { effort: reasoningEffort }
    : descriptor.reasoning

  // Determine transport based on model or base URL
  let transport: ProviderTransport
  if (modelPrefix === 'antigravity' || modelPrefix === 'google') {
    transport = 'antigravity_generate_content'
  } else if (
    modelPrefix === 'vertex' ||
    isVertexModel(requestedModel) ||
    isVertexBaseUrl(rawBaseUrl)
  ) {
    transport = 'vertex_generate_content'
  } else if (
    modelPrefix === 'codex' ||
    isCodexAlias(requestedModel) ||
    isCodexBaseUrl(rawBaseUrl)
  ) {
    transport = 'codex_responses'
  } else {
    transport = 'chat_completions'
  }

  // Set default base URL based on transport
  let defaultBaseUrl: string
  if (modelPrefix === 'antigravity' || modelPrefix === 'google') {
    defaultBaseUrl = DEFAULT_ANTIGRAVITY_BASE_URL
  } else if (modelPrefix === 'gemini') {
    defaultBaseUrl = DEFAULT_GEMINI_OPENAI_BASE_URL
  } else if (modelPrefix === 'zai') {
    defaultBaseUrl = DEFAULT_ZAI_BASE_URL
  } else if (transport === 'vertex_generate_content') {
    defaultBaseUrl = DEFAULT_VERTEX_BASE_URL
  } else if (transport === 'codex_responses') {
    defaultBaseUrl = DEFAULT_CODEX_BASE_URL
  } else {
    defaultBaseUrl = DEFAULT_OPENAI_BASE_URL
  }

  return {
    transport,
    providerPrefix,
    requestedModel,
    resolvedModel: stripModelProviderPrefix(descriptor.baseModel),
    baseUrl: (rawBaseUrl ?? defaultBaseUrl).replace(/\/+$/, ''),
    reasoning,
  }
}

export function resolveCodexAuthPath(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const explicit = asTrimmedString(env.CODEX_AUTH_JSON_PATH)
  if (explicit) return explicit

  const codexHome = asTrimmedString(env.CODEX_HOME)
  if (codexHome) return join(codexHome, 'auth.json')

  return join(homedir(), '.codex', 'auth.json')
}

export function parseChatgptAccountId(
  token: string | undefined,
): string | undefined {
  if (!token) return undefined
  const payload = decodeJwtPayload(token)
  const fromClaim = asTrimmedString(
    payload?.['https://api.openai.com/auth.chatgpt_account_id'],
  )
  if (fromClaim) return fromClaim
  return asTrimmedString(payload?.chatgpt_account_id)
}

function loadCodexAuthJson(
  authPath: string,
): Record<string, unknown> | undefined {
  if (!existsSync(authPath)) return undefined
  try {
    const raw = readFileSync(authPath, 'utf8')
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : undefined
  } catch {
    return undefined
  }
}

export function resolveCodexApiCredentials(
  env: NodeJS.ProcessEnv = process.env,
): ResolvedCodexCredentials {
  const envApiKey = asTrimmedString(env.CODEX_API_KEY)
  const envAccountId =
    asTrimmedString(env.CODEX_ACCOUNT_ID) ??
    asTrimmedString(env.CHATGPT_ACCOUNT_ID)

  if (envApiKey) {
    return {
      apiKey: envApiKey,
      accountId: envAccountId ?? parseChatgptAccountId(envApiKey),
      source: 'env',
    }
  }

  const authPath = resolveCodexAuthPath(env)
  const authJson = loadCodexAuthJson(authPath)
  if (!authJson) {
    return {
      apiKey: '',
      authPath,
      source: 'none',
    }
  }

  const apiKey = readNestedString(authJson, [
    ['access_token'],
    ['accessToken'],
    ['tokens', 'access_token'],
    ['tokens', 'accessToken'],
    ['auth', 'access_token'],
    ['auth', 'accessToken'],
    ['token', 'access_token'],
    ['token', 'accessToken'],
    ['tokens', 'id_token'],
    ['tokens', 'idToken'],
  ])
  const accountId =
    envAccountId ??
    readNestedString(authJson, [
      ['account_id'],
      ['accountId'],
      ['tokens', 'account_id'],
      ['tokens', 'accountId'],
      ['auth', 'account_id'],
      ['auth', 'accountId'],
    ]) ??
    parseChatgptAccountId(apiKey)

  if (!apiKey) {
    return {
      apiKey: '',
      accountId,
      authPath,
      source: 'none',
    }
  }

  return {
    apiKey,
    accountId,
    authPath,
    source: 'auth.json',
  }
}
