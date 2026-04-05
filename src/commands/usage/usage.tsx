import * as React from 'react'
import { useEffect, useState } from 'react'
import { Box, Text, useInput } from '../../ink.js'
import { type Account, loadAccounts, updateAccount } from '../../utils/accountManager.js'
import { resolveCodexApiCredentials } from '../../services/api/providerConfig.js'
import { assertAntigravityOAuthConfig } from '../../utils/antigravityOAuth.js'
import { syncAntigravityLocalSessions } from '../../utils/antigravityLocalSessions.js'
import { fetchAntigravityLocalUsage, getAntigravityLocalUsageSnapshotPath, getSavedAntigravityLocalUsage, type AntigravityLocalUsageSnapshot } from '../../utils/antigravityLocalUsage.js'
import { fetchUtilization, type Utilization } from '../../services/api/usage.js'
import { appendHttpLog } from '../../services/api/httpLog.js'
import type { LocalJSXCommandCall } from '../../types/command.js'

const AG_CLOUDCODE_BASE = 'https://cloudcode-pa.googleapis.com'
const AG_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const AG_PLATFORM = 'PLATFORM_UNSPECIFIED'
const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const CODEX_TOKEN_URL = 'https://auth.openai.com/oauth/token'
const CODEX_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage'
const BLUE = '#4696ff'
const DIM = '#5a82af'
const ACCENT = '#64b4ff'
const WARN = '#ff9944'
const OK = '#44cc88'
const RED = '#ff5555'
const USAGE_CACHE_TTL_MS = 60_000
const USAGE_BAR_FILL = '#2f80ed'
const USAGE_BAR_TRACK = '#17324d'
const USAGE_BAR_BRACKET = '#6b8fb8'
const USAGE_BAR_GLYPH = '█'
const PAGE_ORDER = ['codex', 'claude', 'antigravity', 'zai'] as const

type ProviderPage = (typeof PAGE_ORDER)[number]

type Card<T> = {
  id: string
  title: string
  account: Account
  data: T | null
  error: string | null
  loading: boolean
}

type AGData = {
  plan: string | null
  projectId: string | null
  credits: number | null
  monthly: number | null
  models: Array<{ name: string; used: number }>
  modelsError?: string | null
  capturedAt?: string | null
}

type ZAIData = {
  plan: string | null
  limits: Array<{ name: string; used: number; resetAt: string | null }>
}

type CodexData = {
  plan: string
  credits: { unlimited: boolean; balance: number } | null
  windows: Array<{ label: string; used: number; resetAt: string | number | null; mode: 'time' | 'datetime' }>
}

type ClaudeData = {
  windows: Array<{ label: string; used: number; resetAt: string | null }>
  extra: { enabled: boolean; used: number | null; usedCredits: number | null; monthly: number | null } | null
}

type State = {
  antigravity: Card<AGData>[]
  zai: Card<ZAIData>[]
  codex: Card<CodexData>[]
  claude: Card<ClaudeData>[]
}

let usagePageCache: Partial<
  Record<ProviderPage, { data: unknown; cachedAt: number }>
> = {}

function pct(n: unknown) {
  const v = typeof n === 'number' ? n : Number(n ?? 0)
  return Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 0
}
function pctColor(v: number) {
  return v >= 90 ? RED : v >= 70 ? WARN : ACCENT
}
function UsageBar({ value, width = 12 }: { value: number; width?: number }) {
  const filled = Math.round((pct(value) / 100) * width)
  const empty = Math.max(0, width - filled)

  return (
    <Text>
      <Text color={USAGE_BAR_BRACKET}>[</Text>
      <Text color={USAGE_BAR_FILL}>{USAGE_BAR_GLYPH.repeat(filled)}</Text>
      <Text color={USAGE_BAR_TRACK}>{USAGE_BAR_GLYPH.repeat(empty)}</Text>
      <Text color={USAGE_BAR_BRACKET}>]</Text>
    </Text>
  )
}
function err(e: unknown) {
  return e instanceof Error ? e.message : String(e)
}
function normalizeEmail(value?: string | null) {
  const trimmed = value?.trim().toLowerCase()
  return trimmed || null
}
function sortNewestFirst(accounts: Account[]) {
  return [...accounts].sort(
    (left, right) =>
      Date.parse(right.addedAt || '') - Date.parse(left.addedAt || ''),
  )
}
async function withRetry<T>(fn: () => Promise<T>, retries: number = 3) {
  let lastError: unknown
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      if (attempt === retries) break
      await new Promise(resolve => setTimeout(resolve, attempt * 350))
    }
  }
  throw lastError
}
function parseDate(value: string | number | null) {
  if (value == null) return null
  if (typeof value === 'number') {
    const d = new Date(value > 10_000_000_000 ? value : value * 1000)
    return Number.isNaN(d.getTime()) ? null : d
  }
  const raw = String(value).trim()
  if (!raw) return null
  if (/^\d+$/.test(raw)) return parseDate(Number(raw))
  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? null : d
}
function fmtReset(value: string | number | null, mode: 'time' | 'datetime') {
  const d = parseDate(value)
  if (!d) return null
  return new Intl.DateTimeFormat(undefined, mode === 'time'
    ? { hour: 'numeric', minute: '2-digit' }
    : { day: '2-digit', month: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit' },
  ).format(d)
}
function card<T>(account: Account, provider: string, fallback: string): Card<T> {
  return {
    id: account.id,
    title: `${provider} (${account.email?.trim() || account.label?.trim() || fallback})`,
    account,
    data: null,
    error: null,
    loading: true,
  }
}
function sectionTitle(title: string) {
  return (
    <Box marginBottom={0}>
      <Text color={BLUE} bold>{'─── '}</Text>
      <Text color={ACCENT} bold>{title}</Text>
      <Text color={BLUE} bold>{' ───'}</Text>
    </Box>
  )
}
function panel({ title, subtitle, loading, error, children }: { title: string; subtitle?: string; loading: boolean; error: string | null; children?: React.ReactNode }) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      {sectionTitle(title)}
      {subtitle && <Text color={DIM}>  {subtitle}</Text>}
      {error && <Text color={RED}>  {error}</Text>}
      {loading && !error && <Text color={DIM}>  Loading…</Text>}
      {!loading && !error && children}
    </Box>
  )
}
function agHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
    'X-Goog-Api-Client': 'google-cloud-sdk vscode_cloudshelleditor/0.1',
    'Client-Metadata': `{"ideType":"ANTIGRAVITY","platform":"${AG_PLATFORM}","pluginType":"GEMINI"}`,
  }
}
function parseStoredGoogle(value?: string) {
  const raw = value?.trim()
  if (!raw) return null
  const [refreshToken = '', projectId = '', managedProjectId = ''] = raw.split('|')
  if (!refreshToken.trim()) return null
  return { refreshToken: refreshToken.trim(), projectId: projectId.trim() || undefined, managedProjectId: managedProjectId.trim() || undefined }
}
async function refreshGoogleToken(refreshToken: string) {
  const oauth = assertAntigravityOAuthConfig()
  const res = await fetch(AG_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: oauth.clientId, client_secret: oauth.clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }).toString(),
  })
  if (!res.ok) throw new Error(`Google token refresh ${res.status}`)
  const json = (await res.json()) as { access_token?: string }
  if (!json.access_token) throw new Error('Google token refresh returned no access token')
  return json.access_token
}
function agModelName(name: string) {
  return name.replace(/^antigravity-/, '').replace(/-/g, ' ').replace(/\b\w/g, m => m.toUpperCase())
}
function mergeAntigravityAccounts(
  accounts: Account[],
  syncLocal: boolean = true,
) {
  const storedGoogle = accounts.filter(a => a.type === 'google_oauth' && a.refreshToken)
  const localSessions = syncLocal ? syncAntigravityLocalSessions() : []
  const localByEmail = new Map(localSessions.map(session => [session.email.toLowerCase(), session]))

  const mergedStored = storedGoogle.map(account => {
    const emailKey = account.email?.trim().toLowerCase()
    const local = emailKey ? localByEmail.get(emailKey) : undefined
    if (!local?.refreshToken) return account
    return {
      ...account,
      refreshToken: account.projectId
        ? `${local.refreshToken}|${account.projectId}`
        : local.refreshToken,
    }
  })

  const existingEmails = new Set(
    mergedStored
      .map(account => account.email?.trim().toLowerCase())
      .filter((value): value is string => Boolean(value)),
  )

  const ephemeral = localSessions
    .filter(session => session.refreshToken && !existingEmails.has(session.email.toLowerCase()))
    .map<Account>(session => ({
      id: `antigravity-local-${session.email.toLowerCase()}`,
      type: 'google_oauth',
      label: `Antigravity local: ${session.email}`,
      enabled: true,
      refreshToken: session.refreshToken ?? undefined,
      email: session.email,
      addedAt: session.updatedAt,
    }))

  return [...mergedStored, ...ephemeral]
}

function syncAndLogAntigravityLocalSessions(label: string) {
  const sessions = syncAntigravityLocalSessions()
  appendHttpLog(
    label,
    'syncAntigravityLocalSessions()',
    JSON.stringify({
      count: sessions.length,
      emails: sessions.map(session => session.email),
    }),
  )
  return sessions
}
async function fetchAntigravity(
  account: Account,
  liveLocal: AntigravityLocalUsageSnapshot | null,
): Promise<AGData> {
  const localMatch = [liveLocal, ...getSavedAntigravityLocalUsage(account.email)].find(
    (item): item is NonNullable<typeof liveLocal> =>
      Boolean(item && account.email && item.email.toLowerCase() === account.email.toLowerCase()),
  )

  if (localMatch) {
    const storedProjectId = parseStoredGoogle(account.refreshToken)?.projectId
    return {
      plan: localMatch.plan,
      projectId: localMatch.projectId ?? account.projectId ?? storedProjectId ?? null,
      credits: localMatch.credits,
      monthly: localMatch.monthly,
      models: localMatch.models.map(model => ({ name: model.name, used: model.used })),
      modelsError: null,
      capturedAt: localMatch.capturedAt ?? null,
    }
  }

  const stored = parseStoredGoogle(account.refreshToken)
  if (!stored) throw new Error('Invalid Antigravity refresh token')
  const token = await withRetry(() => refreshGoogleToken(stored.refreshToken))
  const metadata = account.projectId || stored.projectId
    ? { ideType: 'ANTIGRAVITY', platform: AG_PLATFORM, pluginType: 'GEMINI', duetProject: account.projectId || stored.projectId }
    : { ideType: 'ANTIGRAVITY', platform: AG_PLATFORM, pluginType: 'GEMINI' }
  const headers = agHeaders(token)
  const lcRes = await withRetry(() => fetch(`${AG_CLOUDCODE_BASE}/v1internal:loadCodeAssist`, { method: 'POST', headers, body: JSON.stringify({ metadata }) }))
  if (!lcRes.ok) {
    const errorBody = await lcRes.text().catch(() => 'unknown error')
    appendHttpLog(
      `usage antigravity ${account.email ?? account.label ?? account.id} loadCodeAssist error`,
      `POST ${AG_CLOUDCODE_BASE}/v1internal:loadCodeAssist\n${Object.entries(headers).map(([key, value]) => `${key}: ${value}`).join('\n')}\n\n${JSON.stringify({ metadata })}`,
      `status=${lcRes.status}\n${errorBody}`,
    )
    throw new Error(`Antigravity loadCodeAssist ${lcRes.status}: ${errorBody}`)
  }
  const lc = (await lcRes.json()) as Record<string, any>
  const projectId = account.projectId || stored.projectId || lc.cloudaicompanionProject || stored.managedProjectId || null
  if (!projectId) throw new Error('Antigravity did not return a project ID')
  let models: Array<{ name: string; used: number }> = []
  let modelsError: string | null = null
  const modRes = await withRetry(() => fetch(`${AG_CLOUDCODE_BASE}/v1internal:fetchAvailableModels`, { method: 'POST', headers, body: JSON.stringify({ project: projectId }) })).catch(error => error)
  if (modRes instanceof Error) {
    modelsError = err(modRes)
  } else if (!modRes.ok) {
    const errorBody = await modRes.text().catch(() => 'unknown error')
    appendHttpLog(
      `usage antigravity ${account.email ?? account.label ?? account.id} fetchAvailableModels error`,
      `POST ${AG_CLOUDCODE_BASE}/v1internal:fetchAvailableModels\n${Object.entries(headers).map(([key, value]) => `${key}: ${value}`).join('\n')}\n\n${JSON.stringify({ project: projectId })}`,
      `status=${modRes.status}\n${errorBody}`,
    )
    if (modRes.status === 403) {
      modelsError = 'This account does not have permission to view per-model quota.'
    } else {
      modelsError = `Antigravity fetchAvailableModels ${modRes.status}: ${errorBody}`
    }
  } else {
    const mod = (await modRes.json()) as Record<string, any>
    const items = Array.isArray(mod.models) ? mod.models : Object.entries(mod.models ?? {}).map(([name, value]) => ({ name, ...(value as object) }))
    models = items.map((item: any) => {
      const remaining = typeof item?.quotaInfo?.remainingFraction === 'number' ? item.quotaInfo.remainingFraction : Number(item?.quotaInfo?.remainingFraction)
      if (!Number.isFinite(remaining)) return null
      return { name: agModelName(item.displayName?.trim() || item.name?.trim() || 'unknown'), used: Math.round((1 - remaining) * 100) }
    }).filter(Boolean).sort((a: any, b: any) => b.used - a.used)
  }
  return {
    plan: lc.currentTier?.name ?? lc.currentTier?.id ?? null,
    projectId,
    credits: typeof lc.availablePromptCredits === 'number' ? lc.availablePromptCredits : null,
    monthly: typeof lc.planInfo?.monthlyPromptCredits === 'number' ? lc.planInfo.monthlyPromptCredits : null,
    models,
    modelsError,
    capturedAt: null,
  }
}
function zaiLimitName(limit: any) {
  const type = String(limit?.type ?? '')
  const unit = String(limit?.unit ?? '')
  const number = String(limit?.number ?? '')
  if (type === 'TOKENS_LIMIT' && unit === '3' && number === '5') return '5-hour token quota'
  if (type === 'TOKENS_LIMIT' && unit === '6' && number === '1') return 'Weekly token quota'
  if (type === 'TIME_LIMIT' && unit === '5' && number === '1') return 'Web search quota'
  return [type, unit, number].filter(Boolean).join(' ').trim() || 'Unknown quota'
}
async function fetchZAI(apiKey: string): Promise<ZAIData> {
  const res = await withRetry(() => fetch('https://api.z.ai/api/monitor/usage/quota/limit', { headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' } }))
  if (!res.ok) {
    const errorBody = await res.text().catch(() => 'unknown error')
    appendHttpLog(
      'usage zai quota error',
      'GET https://api.z.ai/api/monitor/usage/quota/limit\nAuthorization: Bearer <redacted>\nAccept: application/json',
      `status=${res.status}\n${errorBody}`,
    )
    throw new Error(`Z.AI API ${res.status}: ${errorBody}`)
  }
  const json = (await res.json()) as Record<string, any>
  const root = json.data && typeof json.data === 'object' ? json.data : json
  return {
    plan: root.level ?? null,
    limits: (root.limits ?? []).map((limit: any) => ({ name: zaiLimitName(limit), used: pct(limit.percentage), resetAt: fmtReset(limit.nextResetTime ?? null, 'datetime') })),
  }
}
async function refreshCodexToken(refreshToken: string) {
  const res = await fetch(CODEX_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CODEX_CLIENT_ID, refresh_token: refreshToken, grant_type: 'refresh_token' }).toString(),
  })
  if (!res.ok) {
    const errorBody = await res.text().catch(() => 'unknown error')
    appendHttpLog(
      'usage codex refresh error',
      `POST ${CODEX_TOKEN_URL}\nContent-Type: application/x-www-form-urlencoded`,
      `status=${res.status}\n${errorBody}`,
    )
    if (res.status === 401) {
      throw new Error('Codex session expired. Re-run /auth for that ChatGPT account.')
    }
    throw new Error(`Codex token refresh ${res.status}: ${errorBody}`)
  }
  const json = (await res.json()) as { access_token?: string; refresh_token?: string }
  if (!json.access_token) throw new Error('Codex token refresh returned no access token')
  return json
}
async function refreshCodexTokenWithFallback(account: Account) {
  const candidates: Array<{
    refreshToken: string
    account?: Account
    accountId?: string
  }> = []
  const seen = new Set<string>()
  const pushCandidate = (
    refreshToken: string | undefined,
    candidateAccount?: Account,
    accountId?: string,
  ) => {
    const trimmed = refreshToken?.trim()
    if (!trimmed || seen.has(trimmed)) return
    seen.add(trimmed)
    candidates.push({
      refreshToken: trimmed,
      account: candidateAccount,
      accountId: accountId ?? candidateAccount?.accountId,
    })
  }

  pushCandidate(account.refreshToken, account, account.accountId)

  const accountEmail = normalizeEmail(account.email)
  if (accountEmail) {
    const siblingAccounts = sortNewestFirst(
      loadAccounts().accounts.filter(
        item =>
          item.enabled &&
          item.type === 'codex_oauth' &&
          item.id !== account.id &&
          normalizeEmail(item.email) === accountEmail,
      ),
    )
    for (const sibling of siblingAccounts) {
      pushCandidate(sibling.refreshToken, sibling, sibling.accountId)
    }
  }

  const authJsonCredentials = resolveCodexApiCredentials()
  const enabledCodexAccounts = loadAccounts().accounts.filter(
    item => item.enabled && item.type === 'codex_oauth' && item.refreshToken,
  )
  if (
    authJsonCredentials.refreshToken &&
    (!account.accountId ||
      authJsonCredentials.accountId === account.accountId ||
      enabledCodexAccounts.length === 1)
  ) {
    pushCandidate(
      authJsonCredentials.refreshToken,
      undefined,
      authJsonCredentials.accountId,
    )
  }

  let lastError: unknown
  for (const candidate of candidates) {
    try {
      const tokenResponse = await refreshCodexToken(candidate.refreshToken)
      const rotatedRefreshToken =
        tokenResponse.refresh_token ?? candidate.refreshToken

      if (
        candidate.account?.id &&
        rotatedRefreshToken !== candidate.account.refreshToken
      ) {
        updateAccount(candidate.account.id, {
          refreshToken: rotatedRefreshToken,
        })
      }

      if (
        account.id !== candidate.account?.id &&
        rotatedRefreshToken !== account.refreshToken
      ) {
        updateAccount(account.id, {
          refreshToken: rotatedRefreshToken,
          ...(candidate.accountId ? { accountId: candidate.accountId } : {}),
        })
      }

      return {
        tokenResponse,
        accountId: candidate.accountId,
      }
    } catch (error) {
      lastError = error
    }
  }

  throw (
    lastError ??
    new Error('Codex session expired. Re-run /auth for that ChatGPT account.')
  )
}
async function fetchCodex(account: Account): Promise<CodexData> {
  const { tokenResponse, accountId } = await refreshCodexTokenWithFallback(
    account,
  )
  const token = tokenResponse.access_token!
  if (tokenResponse.refresh_token && tokenResponse.refresh_token !== account.refreshToken) {
    updateAccount(account.id, { refreshToken: tokenResponse.refresh_token })
  }
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, 'User-Agent': 'codex-cli' }
  const resolvedAccountId = account.accountId ?? accountId
  if (resolvedAccountId) {
    headers['ChatGPT-Account-Id'] = resolvedAccountId
    if (resolvedAccountId !== account.accountId) {
      updateAccount(account.id, { accountId: resolvedAccountId })
    }
  }
  const res = await fetch(CODEX_USAGE_URL, { headers })
  if (!res.ok) {
    const errorBody = await res.text().catch(() => 'unknown error')
    appendHttpLog(
      `usage codex ${account.email ?? 'unknown'} error`,
      `GET ${CODEX_USAGE_URL}\n${Object.entries(headers).map(([key, value]) => `${key}: ${value}`).join('\n')}`,
      `status=${res.status}\n${errorBody}`,
    )
    throw new Error(`Codex usage API ${res.status}: ${errorBody}`)
  }
  const json = (await res.json()) as Record<string, any>
  const primary = json.rate_limit?.primary_window ?? json.rate_limits?.primary_window ?? json.rateLimit?.primaryWindow ?? {}
  const secondary = json.rate_limit?.secondary_window ?? json.rate_limits?.secondary_window ?? json.rateLimit?.secondaryWindow ?? null
  const windows = [{ label: '5-hour usage window', used: pct(primary.used_percent ?? primary.usedPercent), resetAt: primary.reset_at ?? primary.resetAt ?? null, mode: 'time' as const }]
  if (secondary) windows.push({ label: 'Weekly usage window', used: pct(secondary.used_percent ?? secondary.usedPercent), resetAt: secondary.reset_at ?? secondary.resetAt ?? null, mode: 'datetime' as const })
  return {
    plan: json.plan_type ?? json.planType ?? 'unknown',
    credits: json.credits ? { unlimited: Boolean(json.credits.unlimited), balance: Number(json.credits.balance ?? 0) } : null,
    windows,
  }
}
function mapClaude(data: Utilization | null): ClaudeData {
  const windows: ClaudeData['windows'] = []
  const add = (label: string, value?: { utilization: number | null; resets_at: string | null } | null) => {
    if (value) windows.push({ label, used: pct(value.utilization), resetAt: value.resets_at ?? null })
  }
  add('5-hour usage window', data?.five_hour ?? null)
  add('Weekly usage window', data?.seven_day ?? null)
  add('Weekly OAuth apps window', data?.seven_day_oauth_apps ?? null)
  add('Weekly Opus window', data?.seven_day_opus ?? null)
  add('Weekly Sonnet window', data?.seven_day_sonnet ?? null)
  return {
    windows,
    extra: data?.extra_usage ? {
      enabled: data.extra_usage.is_enabled,
      used: data.extra_usage.utilization == null ? null : pct(data.extra_usage.utilization),
      usedCredits: data.extra_usage.used_credits,
      monthly: data.extra_usage.monthly_limit,
    } : null,
  }
}
function emptyCard<T>(
  id: string,
  title: string,
  type: Account['type'],
  message: string,
): Card<T> {
  return {
    id,
    title,
    account: {
      id,
      type,
      label: title,
      enabled: true,
      addedAt: new Date(0).toISOString(),
    } as Account,
    data: null,
    error: message,
    loading: false,
  }
}

function getDefaultPage(accounts: Account[]): ProviderPage {
  if (accounts.some(account => account.type === 'codex_oauth' && account.refreshToken)) return 'codex'
  if (accounts.some(account => account.type === 'anthropic_oauth' || account.type === 'anthropic_api')) return 'claude'
  if (accounts.some(account => account.type === 'google_oauth' && account.refreshToken)) return 'antigravity'
  if (accounts.some(account => account.type === 'zhipu_api' && account.apiKey)) return 'zai'
  return 'codex'
}

function getInitialCardsForPage(page: ProviderPage): State[ProviderPage] {
  const accounts = loadAccounts().accounts.filter(a => a.enabled)

  if (page === 'codex') {
    const codex = accounts.filter(a => a.type === 'codex_oauth' && a.refreshToken)
    return codex.length
      ? codex.map(a => card<CodexData>(a, 'Codex / ChatGPT', 'Codex account'))
      : [emptyCard<CodexData>('codex-empty', 'Codex / ChatGPT', 'codex_oauth', 'No Codex account (add via /auth)')]
  }

  if (page === 'claude') {
    const claudeOauth = accounts.filter(a => a.type === 'anthropic_oauth')
    const claudeApi = accounts.filter(a => a.type === 'anthropic_api')
    if (claudeOauth.length === 0 && claudeApi.length === 0) {
      return [emptyCard<ClaudeData>('claude-empty', 'Claude.ai', 'anthropic_oauth', 'No Claude account (add via /auth)')]
    }
    return [
      ...claudeOauth.map(a => card<ClaudeData>(a, 'Claude.ai', 'OAuth account')),
      ...claudeApi.map(a => ({ ...card<ClaudeData>(a, 'Anthropic API', 'API key'), loading: false, error: 'Live usage is not available for Anthropic API keys' })),
    ]
  }

  if (page === 'antigravity') {
    const google = mergeAntigravityAccounts(accounts, false)
    return google.length
      ? google.map(a => card<AGData>(a, 'Antigravity', 'Google account'))
      : [emptyCard<AGData>('antigravity-empty', 'Antigravity', 'google_oauth', 'No Antigravity account (add via /auth)')]
  }

  const zai = accounts.filter(a => a.type === 'zhipu_api' && a.apiKey)
  return zai.length
    ? zai.map(a => card<ZAIData>(a, 'Z.AI', 'API key'))
    : [emptyCard<ZAIData>('zai-empty', 'Z.AI', 'zhipu_api', 'No Z.AI API key (add via /auth)')]
}

async function loadPageData(page: ProviderPage): Promise<State[ProviderPage]> {
  const accounts = loadAccounts().accounts.filter(a => a.enabled)

  if (page === 'antigravity') {
    const google = mergeAntigravityAccounts(accounts)
    if (google.length === 0) return getInitialCardsForPage(page)

    syncAndLogAntigravityLocalSessions('usage antigravity session sync startup')
    let liveLocal: AntigravityLocalUsageSnapshot | null = null
    try {
      liveLocal = await fetchAntigravityLocalUsage()
      syncAndLogAntigravityLocalSessions('usage antigravity session sync after local usage success')
      appendHttpLog(
        'usage antigravity local usage success',
        `local snapshot file: ${getAntigravityLocalUsageSnapshotPath()}`,
        liveLocal
          ? JSON.stringify({
              email: liveLocal.email,
              capturedAt: liveLocal.capturedAt ?? null,
              models: liveLocal.models.map(model => model.name),
            })
          : 'no local usage returned',
      )
    } catch (error) {
      appendHttpLog(
        'usage antigravity local usage error',
        `local snapshot file: ${getAntigravityLocalUsageSnapshotPath()}`,
        err(error),
      )
    }

    return Promise.all(
      google.map(async account => {
        const base = card<AGData>(account, 'Antigravity', 'Google account')
        try {
          return { ...base, data: await fetchAntigravity(account, liveLocal), error: null, loading: false }
        } catch (error) {
          return { ...base, data: null, error: err(error), loading: false }
        }
      }),
    )
  }

  if (page === 'zai') {
    const zai = accounts.filter(a => a.type === 'zhipu_api' && a.apiKey)
    if (zai.length === 0) return getInitialCardsForPage(page)
    return Promise.all(
      zai.map(async account => {
        const base = card<ZAIData>(account, 'Z.AI', 'API key')
        try {
          return { ...base, data: await fetchZAI(account.apiKey!), error: null, loading: false }
        } catch (error) {
          return { ...base, data: null, error: err(error), loading: false }
        }
      }),
    )
  }

  if (page === 'codex') {
    const codex = accounts.filter(a => a.type === 'codex_oauth' && a.refreshToken)
    if (codex.length === 0) return getInitialCardsForPage(page)
    return Promise.all(
      codex.map(async account => {
        const base = card<CodexData>(account, 'Codex / ChatGPT', 'Codex account')
        try {
          return { ...base, data: await fetchCodex(account), error: null, loading: false }
        } catch (error) {
          return { ...base, data: null, error: err(error), loading: false }
        }
      }),
    )
  }

  const claudeOauth = accounts.filter(a => a.type === 'anthropic_oauth')
  const claudeApi = accounts.filter(a => a.type === 'anthropic_api')
  if (claudeOauth.length === 0 && claudeApi.length === 0) return getInitialCardsForPage(page)

  let result: Utilization | null = null
  let fetchError: string | null = null
  if (claudeOauth.length > 0) {
    try {
      result = await fetchUtilization()
    } catch (error) {
      fetchError = err(error)
    }
  }

  let first = true
  return [
    ...claudeOauth.map(account => {
      const base = card<ClaudeData>(account, 'Claude.ai', 'OAuth account')
      if (fetchError) return { ...base, data: null, error: fetchError, loading: false }
      if (first) {
        first = false
        return { ...base, data: mapClaude(result), error: null, loading: false }
      }
      return {
        ...base,
        data: null,
        error: 'This app only has live Claude.ai usage for the active Claude session. Stored Claude OAuth accounts are placeholders only right now.',
        loading: false,
      }
    }),
    ...claudeApi.map(a => ({ ...card<ClaudeData>(a, 'Anthropic API', 'API key'), loading: false, error: 'Live usage is not available for Anthropic API keys' })),
  ]
}

function renderTabs(activePage: ProviderPage) {
  return (
    <Box marginBottom={1}>
      {PAGE_ORDER.map((page, index) => {
        const active = page === activePage
        const label =
          page === 'codex'
            ? 'Codex'
            : page === 'claude'
              ? 'Claude'
              : page === 'antigravity'
                ? 'Antigravity'
                : 'Z.AI'

        return (
          <Box key={page} marginRight={1}>
            <Text
              color={active ? ACCENT : DIM}
              backgroundColor={active ? '#183452' : undefined}
              bold={active}
            >
              {` ${index + 1}. ${label} `}
            </Text>
          </Box>
        )
      })}
    </Box>
  )
}

function renderPage(page: ProviderPage, data: State) {
  const items =
    page === 'antigravity'
      ? data.antigravity
      : page === 'zai'
        ? data.zai
        : page === 'codex'
          ? data.codex
          : data.claude

  return items.map(c => (
    <React.Fragment key={c.id}>
      {panel({
        title: c.title,
        loading: c.loading,
        error: c.error,
        children:
          c.data &&
          (page === 'antigravity' ? (
            <>
              {(c.data.plan || c.data.credits != null) && <Box><Text color={DIM}>  Plan: </Text><Text color={ACCENT}>{c.data.plan ?? 'unknown'}</Text>{c.data.credits != null && <><Text color={DIM}>   Credits: </Text><Text color={ACCENT}>{c.data.credits}</Text>{c.data.monthly != null && <Text color={DIM}> / {c.data.monthly}</Text>}</>}</Box>}
              {('projectId' in c.data) && c.data.projectId && <Box><Text color={DIM}>  Project: </Text><Text color={ACCENT}>{c.data.projectId}</Text></Box>}
              {'modelsError' in c.data && c.data.modelsError && <Text color={WARN}>  {c.data.modelsError}</Text>}
              {'models' in c.data && c.data.models.length === 0 && !c.data.modelsError && <Text color={DIM}>  No Antigravity model quota data returned</Text>}
              {'models' in c.data && c.data.models.map(m => <Box key={m.name}><Text color={DIM}>  {m.name.slice(0, 24).padEnd(24)}</Text><UsageBar value={m.used} /><Text color={pctColor(m.used)}> {String(m.used).padStart(3)}% used</Text></Box>)}
              {'capturedAt' in c.data && c.data.capturedAt && <Text color={DIM}>  captured at {fmtReset(c.data.capturedAt, 'datetime')}</Text>}
            </>
          ) : page === 'zai' ? (
            <>
              <Box><Text color={DIM}>  Plan: </Text><Text color={ACCENT}>{c.data.plan ?? 'unknown'}</Text></Box>
              {c.data.limits.length === 0 && <Text color={DIM}>  No quota data returned</Text>}
              {c.data.limits.map(l => <Box key={l.name} flexDirection="column"><Box><Text color={DIM}>  {l.name.slice(0, 24).padEnd(24)}</Text><UsageBar value={l.used} /><Text color={pctColor(l.used)}> {String(l.used).padStart(3)}% used</Text></Box>{l.resetAt && <Box><Text color={DIM}>{''.padEnd(26)}</Text><Text color={DIM}>resets at {l.resetAt}</Text></Box>}</Box>)}
            </>
          ) : page === 'codex' ? (
            <>
              <Box><Text color={DIM}>  Plan: </Text><Text color={ACCENT}>{c.data.plan}</Text>{c.data.credits && !c.data.credits.unlimited && <><Text color={DIM}>   Credits: </Text><Text color={ACCENT}>{c.data.credits.balance}</Text></>}{c.data.credits?.unlimited && <Text color={OK}>   (unlimited)</Text>}</Box>
              {c.data.windows.map(w => <Box key={w.label}><Text color={DIM}>  {w.label.padEnd(22)}</Text><UsageBar value={w.used} /><Text color={pctColor(w.used)}> {String(Math.round(w.used)).padStart(3)}% used</Text>{fmtReset(w.resetAt, w.mode) && <Text color={DIM}>  resets at {fmtReset(w.resetAt, w.mode)}</Text>}</Box>)}
            </>
          ) : (
            <>
              {c.data.windows.length === 0 && !c.data.extra && <Text color={DIM}>  No Claude.ai usage data returned</Text>}
              {c.data.windows.map(w => <Box key={w.label}><Text color={DIM}>  {w.label.padEnd(24)}</Text><UsageBar value={w.used} /><Text color={pctColor(w.used)}> {String(Math.round(w.used)).padStart(3)}% used</Text>{fmtReset(w.resetAt, 'datetime') && <Text color={DIM}>  resets at {fmtReset(w.resetAt, 'datetime')}</Text>}</Box>)}
              {c.data.extra && <><Box><Text color={DIM}>  Extra usage</Text><Text color={c.data.extra.enabled ? OK : WARN}>{c.data.extra.enabled ? ' enabled' : ' disabled'}</Text></Box>{c.data.extra.used != null && <Box><Text color={DIM}>  Monthly extra usage        </Text><UsageBar value={c.data.extra.used} /><Text color={pctColor(c.data.extra.used)}> {String(Math.round(c.data.extra.used)).padStart(3)}% used</Text></Box>}{(c.data.extra.usedCredits != null || c.data.extra.monthly != null) && <Box><Text color={DIM}>  Credits: </Text><Text color={ACCENT}>{c.data.extra.usedCredits ?? 0}</Text><Text color={DIM}> / {c.data.extra.monthly ?? 'unknown'}</Text></Box>}</>}
            </>
          )),
      })}
    </React.Fragment>
  ))
}

function UsageDashboard({ onDone }: { onDone: () => void }) {
  const initialAccounts = loadAccounts().accounts.filter(a => a.enabled)
  const [activePage, setActivePage] = useState<ProviderPage>(
    getDefaultPage(initialAccounts),
  )
  const [refreshKey, setRefreshKey] = useState(0)
  const [data, setData] = useState<State>({
    antigravity: getInitialCardsForPage('antigravity'),
    zai: getInitialCardsForPage('zai'),
    codex: getInitialCardsForPage('codex'),
    claude: getInitialCardsForPage('claude'),
  })

  useEffect(() => {
    const cached = usagePageCache[activePage]
    if (cached && Date.now() - cached.cachedAt < USAGE_CACHE_TTL_MS) {
      setData(prev => ({
        ...prev,
        [activePage]: cached.data as State[typeof activePage],
      }))
      return
    }

    let cancelled = false
    setData(prev => ({
      ...prev,
      [activePage]: getInitialCardsForPage(activePage),
    }))

    void loadPageData(activePage).then(pageData => {
      if (cancelled) return
      usagePageCache[activePage] = {
        data: pageData,
        cachedAt: Date.now(),
      }
      setData(prev => ({
        ...prev,
        [activePage]: pageData,
      }))
    })

    return () => {
      cancelled = true
    }
  }, [activePage, refreshKey])

  useInput((input, key) => {
    if (key.escape || key.return) {
      onDone()
      return
    }

    if (key.leftArrow) {
      const index = PAGE_ORDER.indexOf(activePage)
      setActivePage(PAGE_ORDER[(index + PAGE_ORDER.length - 1) % PAGE_ORDER.length]!)
      return
    }

    if (key.rightArrow || key.tab) {
      const index = PAGE_ORDER.indexOf(activePage)
      setActivePage(PAGE_ORDER[(index + 1) % PAGE_ORDER.length]!)
      return
    }

    if (input >= '1' && input <= '4') {
      const page = PAGE_ORDER[Number(input) - 1]
      if (page) setActivePage(page)
      return
    }

    if (input.toLowerCase() === 'r') {
      delete usagePageCache[activePage]
      setRefreshKey(value => value + 1)
    }
  })

  return (
    <Box flexDirection="column" paddingTop={1}>
      <Box marginBottom={1} flexDirection="column">
        <Text color={ACCENT} bold>  snowcode /usage  </Text>
        <Text color={DIM}>  1-4 or left/right to switch pages · r to refresh · Enter/Esc to close</Text>
      </Box>
      {renderTabs(activePage)}
      {renderPage(activePage, data)}
    </Box>
  )
}

export const call: LocalJSXCommandCall = async (onDone, _context) => {
  return (
    <UsageDashboard
      onDone={() => onDone(undefined, { display: 'skip' })}
    />
  )
}
