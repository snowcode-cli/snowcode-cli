import * as React from 'react'
import { useState, useEffect } from 'react'
import { createServer } from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { LocalJSXCommandContext, LocalJSXCommandOnDone } from '../../commands.js'
import { ConsoleOAuthFlow } from '../../components/ConsoleOAuthFlow.js'
import { Dialog } from '../../components/design-system/Dialog.js'
import { Box, Text } from '../../ink.js'
import { useInput } from '../../ink.js'
import { Select } from '../../components/CustomSelect/select.js'
import { Spinner } from '../../components/Spinner.js'
import { assertAntigravityOAuthConfig } from '../../utils/antigravityOAuth.js'
import { openBrowser } from '../../utils/browser.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { logError } from '../../utils/log.js'
import { stripSignatureBlocks } from '../../utils/messages.js'
import {
  loadAccounts,
  addAccount,
  removeAccount,
  toggleAccount,
  updateAccount,
  ACCOUNT_TYPE_LABELS,
  type AccountType,
} from '../../utils/accountManager.js'
import { getClaudeAIOAuthTokens } from '../../utils/auth.js'

// ─── Antigravity / Google OAuth ────────────────────────────────────────────────
const AG_REDIRECT_URI = 'http://localhost:51121/oauth-callback'
const AG_SCOPES = [
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/cclog',
  'https://www.googleapis.com/auth/experimentsandconfigs',
].join(' ')
const AG_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const AG_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const AG_USERINFO_URL = 'https://www.googleapis.com/oauth2/v1/userinfo'
const AG_PORT = 51121
const AG_BASE_URLS = [
  'https://daily-cloudcode-pa.googleapis.com',
  'https://cloudcode-pa.googleapis.com',
  'https://autopush-cloudcode-pa.sandbox.googleapis.com',
  'https://daily-cloudcode-pa.sandbox.googleapis.com',
] as const

// ─── Codex / OpenAI OAuth ──────────────────────────────────────────────────────
const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const CODEX_AUTH_URL = 'https://auth.openai.com/oauth/authorize'
const CODEX_TOKEN_URL = 'https://auth.openai.com/oauth/token'
const CODEX_REDIRECT_URI = 'http://localhost:1455/auth/callback'
const CODEX_SCOPES = 'openid profile email offline_access'
const CODEX_PORT = 1455

function appendAuthLog(service: string, message: string): void {
  try {
    const dir = getClaudeConfigHomeDir()
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    appendFileSync(
      join(dir, 'auth.log'),
      `[${new Date().toISOString()}] [${service}] ${message}\n`,
      { mode: 0o600 },
    )
  } catch (error) {
    logError(error)
  }
}

function redactSecrets(value: string): string {
  return value
    .replace(/("access_token"\s*:\s*")([^"]+)(")/gi, '$1<redacted>$3')
    .replace(/("refresh_token"\s*:\s*")([^"]+)(")/gi, '$1<redacted>$3')
    .replace(/("id_token"\s*:\s*")([^"]+)(")/gi, '$1<redacted>$3')
    .replace(/(Authorization:\s*Bearer\s+)[^\s",}]+/gi, '$1<redacted>')
    .replace(/(client_secret=)[^&\s]+/gi, '$1<redacted>')
    .replace(/(refresh_token=)[^&\s]+/gi, '$1<redacted>')
    .replace(/(code=)[^&\s]+/gi, '$1<redacted>')
}

function appendAuthHttpLog(
  service: string,
  label: string,
  requestInfo: string,
  responseInfo: string,
): void {
  try {
    const dir = getClaudeConfigHomeDir()
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    appendFileSync(
      join(dir, 'auth-http.log'),
      `[${new Date().toISOString()}] [${service}] ${label}\nREQUEST:\n${redactSecrets(requestInfo)}\nRESPONSE:\n${redactSecrets(responseInfo)}\n\n`,
      { mode: 0o600 },
    )
  } catch (error) {
    logError(error)
  }
}

// ─── PKCE helpers ──────────────────────────────────────────────────────────────
function pkce() {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const state = randomBytes(16).toString('hex')
  return { verifier, challenge, state }
}

function startCallbackServer(
  port: number,
  callbackPath: string,
  expectedState: string,
  onResult: (result: { code: string } | { error: string }) => void,
): () => void {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${port}`)
    if (!url.pathname.startsWith(callbackPath)) { res.writeHead(404); res.end(); return }
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    const error = url.searchParams.get('error')
    if (error) {
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end('<html><body><h2>Auth failed. Close this tab.</h2></body></html>')
      server.close(); onResult({ error }); return
    }
    if (code && state === expectedState) {
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end('<html><body><h2>Authenticated! Close this tab.</h2></body></html>')
      server.close(); onResult({ code }); return
    }
    res.writeHead(400); res.end()
  })
  server.listen(port)
  // Returns cleanup function to close server if component unmounts
  return () => { try { server.close() } catch {} }
}

async function exchangeTokens(
  tokenUrl: string,
  params: Record<string, string>,
  service: string,
): Promise<{ refresh_token?: string; access_token: string; id_token?: string }> {
  appendAuthLog(service, `token exchange start ${tokenUrl}`)
  const requestBody = new URLSearchParams(params).toString()
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: requestBody,
  })
  const bodyText = await res.text()
  appendAuthLog(
    service,
    `token exchange response status=${res.status} body=${bodyText || '<empty>'}`,
  )
  appendAuthHttpLog(
    service,
    `token exchange ${tokenUrl}`,
    `POST ${tokenUrl}\nContent-Type: application/x-www-form-urlencoded\n\n${requestBody}`,
    `status=${res.status}\n${bodyText || '<empty>'}`,
  )
  if (!res.ok) throw new Error(bodyText)
  return JSON.parse(bodyText) as {
    refresh_token?: string
    access_token: string
    id_token?: string
  }
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  try {
    const parts = token.split('.')
    if (parts.length < 2) return {}
    return JSON.parse(Buffer.from(parts[1]!, 'base64url').toString())
  } catch {
    return {}
  }
}

function emailFromTokens(tokens: { access_token: string; id_token?: string }): string {
  // Prefer id_token (OIDC JWT always has email when openid+email scope granted)
  if (tokens.id_token) {
    const p = decodeJwtPayload(tokens.id_token)
    if (typeof p.email === 'string') return p.email
  }
  // Fallback: try access_token if it's a JWT
  const p = decodeJwtPayload(tokens.access_token)
  if (typeof p.email === 'string') return p.email
  return 'unknown'
}

async function fetchGoogleEmail(accessToken: string, idToken?: string): Promise<string> {
  // Try id_token first (most reliable)
  if (idToken) {
    const p = decodeJwtPayload(idToken)
    if (typeof p.email === 'string') return p.email
  }
  // Fallback: userinfo endpoint
  const res = await fetch(AG_USERINFO_URL, { headers: { Authorization: `Bearer ${accessToken}` } })
  if (!res.ok) return 'unknown'
  const data = await res.json() as { email?: string }
  return data.email ?? 'unknown'
}

async function fetchGoogleProjectId(
  accessToken: string,
): Promise<{ projectId: string; debugLog: string[] }> {
  const metadata = {
    ideType: 'ANTIGRAVITY',
    platform: 'PLATFORM_UNSPECIFIED',
    pluginType: 'GEMINI',
  }
  const debugLog: string[] = []

  for (const baseUrl of AG_BASE_URLS) {
    const loadCodeAssistUrl = `${baseUrl}/v1internal:loadCodeAssist`
    const loadCodeAssistRequestBody = JSON.stringify({ metadata })
    const res = await fetch(loadCodeAssistUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'User-Agent': 'google-api-nodejs-client/9.15.1',
        'X-Goog-Api-Client': 'google-cloud-sdk vscode_cloudshelleditor/0.1',
        'Client-Metadata': `{"ideType":"ANTIGRAVITY","platform":"PLATFORM_UNSPECIFIED","pluginType":"GEMINI"}`,
      },
      body: loadCodeAssistRequestBody,
    }).catch(() => undefined)
    if (!res) {
      debugLog.push(`[loadCodeAssist] ${baseUrl} request failed before response`)
      appendAuthLog('google_oauth', `[loadCodeAssist] ${baseUrl} request failed before response`)
      appendAuthHttpLog(
        'google_oauth',
        'loadCodeAssist',
        `POST ${loadCodeAssistUrl}\nAuthorization: Bearer ${accessToken}\nContent-Type: application/json\nUser-Agent: google-api-nodejs-client/9.15.1\nX-Goog-Api-Client: google-cloud-sdk vscode_cloudshelleditor/0.1\nClient-Metadata: {"ideType":"ANTIGRAVITY","platform":"PLATFORM_UNSPECIFIED","pluginType":"GEMINI"}\n\n${loadCodeAssistRequestBody}`,
        'request failed before response',
      )
      continue
    }
    const loadCodeAssistText = await res.text().catch(() => '')
    debugLog.push(
      `[loadCodeAssist] ${baseUrl} status=${res.status} body=${loadCodeAssistText || '<empty>'}`,
    )
    appendAuthLog(
      'google_oauth',
      `[loadCodeAssist] ${baseUrl} status=${res.status} body=${loadCodeAssistText || '<empty>'}`,
    )
    appendAuthHttpLog(
      'google_oauth',
      'loadCodeAssist',
      `POST ${loadCodeAssistUrl}\nAuthorization: Bearer ${accessToken}\nContent-Type: application/json\nUser-Agent: google-api-nodejs-client/9.15.1\nX-Goog-Api-Client: google-cloud-sdk vscode_cloudshelleditor/0.1\nClient-Metadata: {"ideType":"ANTIGRAVITY","platform":"PLATFORM_UNSPECIFIED","pluginType":"GEMINI"}\n\n${loadCodeAssistRequestBody}`,
      `status=${res.status}\n${loadCodeAssistText || '<empty>'}`,
    )
    if (!res.ok) continue
    const data = JSON.parse(loadCodeAssistText || '{}') as {
      cloudaicompanionProject?: string | { id?: string }
      allowedTiers?: Array<{ id?: string; isDefault?: boolean }>
    }
    if (typeof data.cloudaicompanionProject === 'string' && data.cloudaicompanionProject) {
      return { projectId: data.cloudaicompanionProject, debugLog }
    }
    if (data.cloudaicompanionProject?.id) {
      return { projectId: data.cloudaicompanionProject.id, debugLog }
    }

    const tierId =
      data.allowedTiers?.find(tier => tier?.isDefault)?.id ??
      data.allowedTiers?.[0]?.id ??
      'FREE'

    const onboardUrl = `${baseUrl}/v1internal:onboardUser`
    const onboardRequestBody = JSON.stringify({ tierId, metadata })
    const onboardRes = await fetch(onboardUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'User-Agent': 'google-api-nodejs-client/9.15.1',
        'X-Goog-Api-Client': 'google-cloud-sdk vscode_cloudshelleditor/0.1',
        'Client-Metadata': `{"ideType":"ANTIGRAVITY","platform":"PLATFORM_UNSPECIFIED","pluginType":"GEMINI"}`,
      },
      body: onboardRequestBody,
    }).catch(() => undefined)
    if (!onboardRes) {
      debugLog.push(`[onboardUser] ${baseUrl} request failed before response`)
      appendAuthLog('google_oauth', `[onboardUser] ${baseUrl} request failed before response`)
      appendAuthHttpLog(
        'google_oauth',
        'onboardUser',
        `POST ${onboardUrl}\nAuthorization: Bearer ${accessToken}\nContent-Type: application/json\nUser-Agent: google-api-nodejs-client/9.15.1\nX-Goog-Api-Client: google-cloud-sdk vscode_cloudshelleditor/0.1\nClient-Metadata: {"ideType":"ANTIGRAVITY","platform":"PLATFORM_UNSPECIFIED","pluginType":"GEMINI"}\n\n${onboardRequestBody}`,
        'request failed before response',
      )
      continue
    }
    const onboardText = await onboardRes.text().catch(() => '')
    debugLog.push(
      `[onboardUser] ${baseUrl} status=${onboardRes.status} body=${onboardText || '<empty>'}`,
    )
    appendAuthLog(
      'google_oauth',
      `[onboardUser] ${baseUrl} status=${onboardRes.status} body=${onboardText || '<empty>'}`,
    )
    appendAuthHttpLog(
      'google_oauth',
      'onboardUser',
      `POST ${onboardUrl}\nAuthorization: Bearer ${accessToken}\nContent-Type: application/json\nUser-Agent: google-api-nodejs-client/9.15.1\nX-Goog-Api-Client: google-cloud-sdk vscode_cloudshelleditor/0.1\nClient-Metadata: {"ideType":"ANTIGRAVITY","platform":"PLATFORM_UNSPECIFIED","pluginType":"GEMINI"}\n\n${onboardRequestBody}`,
      `status=${onboardRes.status}\n${onboardText || '<empty>'}`,
    )
    if (!onboardRes.ok) continue
    const onboardData = JSON.parse(onboardText || '{}') as {
      done?: boolean
      response?: { cloudaicompanionProject?: { id?: string } }
    }
    if (onboardData.done && onboardData.response?.cloudaicompanionProject?.id) {
      return {
        projectId: onboardData.response.cloudaicompanionProject.id,
        debugLog,
      }
    }
  }

  return { projectId: '', debugLog }
}

async function fetchAvailableAntigravityModels(
  accessToken: string,
  projectId: string,
): Promise<void> {
  for (const baseUrl of AG_BASE_URLS) {
    const url = `${baseUrl}/v1internal:fetchAvailableModels`
    const requestBody = JSON.stringify({ project: projectId })
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'User-Agent': 'google-api-nodejs-client/9.15.1',
        'X-Goog-Api-Client': 'google-cloud-sdk vscode_cloudshelleditor/0.1',
        'Client-Metadata': `{"ideType":"ANTIGRAVITY","platform":"PLATFORM_UNSPECIFIED","pluginType":"GEMINI"}`,
      },
      body: requestBody,
    }).catch(() => undefined)

    if (!response) {
      appendAuthLog('google_oauth', `[fetchAvailableModels] ${baseUrl} request failed before response`)
      appendAuthHttpLog(
        'google_oauth',
        'fetchAvailableModels',
        `POST ${url}\nAuthorization: Bearer ${accessToken}\nContent-Type: application/json\nUser-Agent: google-api-nodejs-client/9.15.1\nX-Goog-Api-Client: google-cloud-sdk vscode_cloudshelleditor/0.1\nClient-Metadata: {"ideType":"ANTIGRAVITY","platform":"PLATFORM_UNSPECIFIED","pluginType":"GEMINI"}\n\n${requestBody}`,
        'request failed before response',
      )
      continue
    }

    const responseText = await response.text().catch(() => '')
    appendAuthLog(
      'google_oauth',
      `[fetchAvailableModels] ${baseUrl} status=${response.status} body=${responseText || '<empty>'}`,
    )
    appendAuthHttpLog(
      'google_oauth',
      'fetchAvailableModels',
      `POST ${url}\nAuthorization: Bearer ${accessToken}\nContent-Type: application/json\nUser-Agent: google-api-nodejs-client/9.15.1\nX-Goog-Api-Client: google-cloud-sdk vscode_cloudshelleditor/0.1\nClient-Metadata: {"ideType":"ANTIGRAVITY","platform":"PLATFORM_UNSPECIFIED","pluginType":"GEMINI"}\n\n${requestBody}`,
      `status=${response.status}\n${responseText || '<empty>'}`,
    )

    if (response.ok) return
  }
}

// ─── Generic OAuth flow component ─────────────────────────────────────────────
type OAuthFlowState = 'starting' | 'waiting' | 'done' | 'error'

interface OAuthFlowResult {
  email: string
  refreshToken: string
  completionMessage?: string
  pendingGoogleProjectSetup?: {
    email: string
    refreshToken: string
    suggestedProjectId?: string
  }
  duplicateDecision?: {
    message: string
    onReplace: () => OAuthFlowResult
    onKeep: () => OAuthFlowResult
  }
}

function OAuthFlow({
  title,
  service,
  port,
  callbackPath,
  buildAuthUrl,
  doExchange,
  onDone,
}: {
  title: string
  service: string
  port: number
  callbackPath: string
  buildAuthUrl: (state: string, challenge: string) => string
  doExchange: (code: string, verifier: string) => Promise<OAuthFlowResult>
  onDone: (result?: OAuthFlowResult) => void
}) {
  const [flowState, setFlowState] = useState<OAuthFlowState | 'duplicate'>('starting')
  const [authUrl, setAuthUrl] = useState('')
  const [msg, setMsg] = useState('')
  const [result, setResult] = useState<OAuthFlowResult | undefined>()
  const [duplicateDecision, setDuplicateDecision] = useState<OAuthFlowResult['duplicateDecision']>()

  useInput((input, key) => {
    if (flowState !== 'duplicate' || !duplicateDecision) return

    if (input === 'r' || input === 'R') {
      const nextResult = duplicateDecision.onReplace()
      appendAuthLog(service, `oauth duplicate account replaced email=${nextResult.email}`)
      setResult(nextResult)
      setMsg(nextResult.completionMessage ?? `✓ Signed in as ${nextResult.email}`)
      setDuplicateDecision(undefined)
      setFlowState('done')
      return
    }

    if (input === 'k' || input === 'K') {
      const nextResult = duplicateDecision.onKeep()
      appendAuthLog(service, `oauth duplicate account kept existing email=${nextResult.email}`)
      setResult(nextResult)
      setMsg(nextResult.completionMessage ?? `✓ Signed in as ${nextResult.email}`)
      setDuplicateDecision(undefined)
      setFlowState('done')
      return
    }

    if (key.escape) {
      appendAuthLog(service, 'oauth duplicate account prompt cancelled')
      onDone()
    }
  }, { isActive: flowState === 'duplicate' })

  useEffect(() => {
    let cancelled = false
    let serverCleanup: (() => void) | undefined

    const { verifier, challenge, state } = pkce()
    const url = buildAuthUrl(state, challenge)
    setAuthUrl(url)
    setFlowState('waiting')
    appendAuthLog(service, `oauth flow start title="${title}" callbackPath="${callbackPath}"`)
    openBrowser(url).catch(() => {})

    serverCleanup = startCallbackServer(port, callbackPath, state, async (cbResult) => {
      if (cancelled) return
      if ('error' in cbResult) {
        appendAuthLog(service, `oauth callback error ${cbResult.error}`)
        setMsg(cbResult.error); setFlowState('error'); return
      }
      appendAuthLog(service, 'oauth callback received authorization code')
      try {
        const data = await doExchange(cbResult.code, verifier)
        if (data.duplicateDecision) {
          appendAuthLog(service, `oauth duplicate account detected email=${data.email}`)
          if (!cancelled) {
            setResult(data)
            setDuplicateDecision(data.duplicateDecision)
            setMsg(data.duplicateDecision.message)
            setFlowState('duplicate')
          }
          return
        }
        appendAuthLog(service, `oauth flow success email=${data.email}`)
        if (!cancelled) { setResult(data); setMsg(`✓ Signed in as ${data.email}`); setFlowState('done') }
      } catch (err) {
        appendAuthLog(service, `oauth flow failure ${String(err)}`)
        if (!cancelled) { setMsg(String(err)); setFlowState('error') }
      }
    })

    return () => {
      cancelled = true
      serverCleanup?.()
    }
  }, [])

  // Auto-dismiss only on success. Errors should stay visible until the user exits.
  useEffect(() => {
    if (flowState === 'done') {
      const t = setTimeout(() => onDone(result), 800)
      return () => clearTimeout(t)
    }
  }, [flowState, result, onDone])

  if (flowState === 'starting') return <Spinner label={`Opening ${title} login…`} />

  if (flowState === 'waiting') return (
    <Box flexDirection="column" gap={1}>
      <Spinner label={`Waiting for ${title} login…`} />
      {authUrl && <Text dimColor>If browser didn't open: <Text color="cyan">{authUrl.slice(0, 72)}…</Text></Text>}
    </Box>
  )

  if (flowState === 'done') return (
    <Box flexDirection="column" gap={1}>
      <Text color="green">{msg}</Text>
      <Text dimColor>Saved to ~/.snowcode/accounts.json</Text>
    </Box>
  )

  if (flowState === 'duplicate') return (
    <Box flexDirection="column" gap={1}>
      <Text color="yellow">{msg}</Text>
      <Text dimColor>R replace existing · K keep existing · Esc cancel</Text>
    </Box>
  )

  return (
    <Box flexDirection="column" gap={1}>
      <Text color="red">✗ {msg}</Text>
      <Text dimColor>Press Esc to close</Text>
    </Box>
  )
}


// ─── API key input (useInput directly — TextInput focus is blocked by Dialog modal overlay) ──
function ApiKeyInput({
  label,
  envVar,
  accountType,
  onSaved,
  onBack,
}: {
  label: string
  envVar?: string
  accountType: AccountType
  onSaved: (msg: string) => void
  onBack: () => void
}) {
  const [value, setValue] = useState('')

  useInput((input, key) => {
    if (key.return) {
      const trimmed = value.trim()
      if (!trimmed) return
      addAccount({ type: accountType, label: `${label} (${trimmed.slice(0, 8)}…)`, apiKey: trimmed, enabled: true })
      if (envVar) process.env[envVar] = trimmed
      appendAuthLog(accountType, `api key saved label="${label}" envVar="${envVar ?? ''}"`)
      onSaved(`${label} API key saved`)
      return
    }
    if (key.escape) { onBack(); return }
    if (key.backspace || key.delete) { setValue(v => v.slice(0, -1)); return }
    if (input && !key.ctrl && !key.meta) { setValue(v => v + input) }
  })

  return (
    <Box flexDirection="column" gap={1}>
      <Text>Paste your <Text bold>{label}</Text> API key and press Enter</Text>
      {envVar && <Text dimColor>Sets <Text color="cyan">{envVar}</Text> for this session</Text>}
      <Box>
        <Text color="cyan">{'•'.repeat(Math.max(0, value.length - 6))}</Text>
        <Text>{value.slice(-6)}</Text>
        <Text inverse> </Text>
      </Box>
      <Text dimColor>{value.length > 0 ? `${value.length} chars · ` : ''}Enter to save · Esc to go back</Text>
    </Box>
  )
}

function getGoogleProjectEnableUrl(projectId: string): string {
  return `https://console.cloud.google.com/apis/library/cloudaicompanion.googleapis.com?project=${encodeURIComponent(projectId)}`
}

function GoogleProjectInput({
  email,
  refreshToken,
  suggestedProjectId,
  onSaved,
  onBack,
}: {
  email: string
  refreshToken: string
  suggestedProjectId?: string
  onSaved: (msg: string) => void
  onBack: () => void
}) {
  const [projectId, setProjectId] = useState(suggestedProjectId ?? '')
  const [duplicateMode, setDuplicateMode] = useState(false)

  const trimmedProjectId = projectId.trim()
  const enableUrl = trimmedProjectId
    ? getGoogleProjectEnableUrl(trimmedProjectId)
    : undefined

  const saveGoogleAccount = (finalProjectId: string): string => {
    const packedRefreshToken = `${refreshToken}|${finalProjectId}`
    addAccount({
      type: 'google_oauth',
      label: `Google: ${email}`,
      email,
      refreshToken: packedRefreshToken,
      projectId: finalProjectId,
      enabled: true,
    })
    appendAuthLog(
      'google_oauth',
      `account saved email=${email} projectId=${finalProjectId}`,
    )
    return `Google account saved: ${email} (${finalProjectId})`
  }

  const existingAccounts = loadAccounts().accounts.filter(
    account =>
      account.type === 'google_oauth' &&
      account.email?.trim().toLowerCase() === email.trim().toLowerCase(),
  )

  useInput((input, key) => {
    if (duplicateMode) {
      if (input === 'r' || input === 'R') {
        for (const account of existingAccounts) {
          removeAccount(account.id)
        }
        onSaved(saveGoogleAccount(trimmedProjectId))
        return
      }
      if (input === 'k' || input === 'K') {
        appendAuthLog(
          'google_oauth',
          `oauth duplicate account kept existing email=${email}`,
        )
        onSaved(`Existing Google account kept: ${email}`)
        return
      }
      if (key.escape) {
        setDuplicateMode(false)
      }
      return
    }

    if (key.return) {
      if (!trimmedProjectId) return
      if (existingAccounts.length > 0) {
        appendAuthLog(
          'google_oauth',
          `oauth duplicate account detected during project setup email=${email}`,
        )
        setDuplicateMode(true)
        return
      }
      onSaved(saveGoogleAccount(trimmedProjectId))
      return
    }
    if (key.escape) {
      onBack()
      return
    }
    if (key.backspace || key.delete) {
      setProjectId(value => value.slice(0, -1))
      return
    }
    if (input && !key.ctrl && !key.meta) {
      setProjectId(value => value + input)
    }
  })

  if (duplicateMode) {
    return (
      <Box flexDirection="column" gap={1}>
        <Text color="yellow">This Google account already exists: {email}</Text>
        <Text dimColor>R replace existing with project {trimmedProjectId} · K keep existing · Esc cancel</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" gap={1}>
      <Text>Open the Google Cloud link below, enable <Text bold>Gemini for Google Cloud API</Text>, then paste your project ID.</Text>
      {suggestedProjectId ? (
        <Text dimColor>Detected project from Google: <Text color="cyan">{suggestedProjectId}</Text></Text>
      ) : (
        <Text dimColor>No project was auto-detected. Use one of your own GCP project IDs.</Text>
      )}
      <Text dimColor>Project ID for {email}</Text>
      <Box>
        <Text color="cyan">{projectId}</Text>
        <Text inverse> </Text>
      </Box>
      {enableUrl ? (
        <Text dimColor>Enable API: <Text color="cyan">{enableUrl}</Text></Text>
      ) : (
        <Text dimColor>Type a project ID to generate the enable link.</Text>
      )}
      <Text dimColor>Enter to save · Esc to go back</Text>
    </Box>
  )
}

// ─── Step type ─────────────────────────────────────────────────────────────────
type Step =
  | { name: 'menu' }
  | { name: 'add_pick_type' }
  | { name: 'claudeai_oauth' }
  | { name: 'google_oauth' }
  | {
      name: 'google_project_setup'
      email: string
      refreshToken: string
      suggestedProjectId?: string
    }
  | { name: 'codex_oauth' }
  | { name: 'apikey'; accountType: AccountType; label: string }
  | { name: 'manage' }

// ─── Account type options ──────────────────────────────────────────────────────
const ADD_TYPE_OPTIONS: { value: AccountType; label: string; description: string }[] = [
  { value: 'google_oauth',    label: 'Antigravity / Google OAuth', description: 'Free Claude + Gemini via Google account' },
  { value: 'codex_oauth',     label: 'OpenAI Codex OAuth',         description: 'ChatGPT Plus/Pro account' },
  { value: 'anthropic_oauth', label: 'Claude.ai OAuth',            description: 'Anthropic subscription (Pro/Max)' },
  { value: 'anthropic_api',   label: 'Anthropic API key',          description: 'Direct API key (sk-ant-...)' },
  { value: 'openai_api',      label: 'OpenAI API key',             description: 'OpenAI platform API key' },
  { value: 'gemini_api',      label: 'Gemini API key',             description: 'Google AI Studio key' },
  { value: 'zhipu_api',       label: 'Z.AI GLM API key',        description: 'Z.AI platform key' },
  { value: 'vertex_api',      label: 'Vertex AI API key',          description: 'Google Cloud Vertex key' },
]

const API_KEY_ENV: Partial<Record<AccountType, string>> = {
  anthropic_api: 'ANTHROPIC_API_KEY',
  openai_api:    'OPENAI_API_KEY',
  gemini_api:    'GEMINI_API_KEY',
  zhipu_api:     'ZHIPUAI_API_KEY',
  vertex_api:    'VERTEX_AI_API_KEY',
}

// ─── Manage accounts list ──────────────────────────────────────────────────────
function ManageAccounts({ onBack }: { onBack: () => void }) {
  const [accounts, setAccounts] = useState(() => loadAccounts().accounts)
  const [selected, setSelected] = useState(0)
  const [confirmRemove, setConfirmRemove] = useState(false)

  const refresh = () => {
    const updated = loadAccounts().accounts
    setAccounts(updated)
    setSelected(s => Math.min(s, Math.max(0, updated.length - 1)))
  }

  useInput((input, key) => {
    if (confirmRemove) {
      if (input === 'y' || input === 'Y') {
        const acc = accounts[selected]
        if (acc) { appendAuthLog(acc.type, `account removed id=${acc.id} label="${acc.email ?? acc.label}"`); removeAccount(acc.id); refresh() }
        setConfirmRemove(false)
      } else {
        setConfirmRemove(false)
      }
      return
    }

    if (key.upArrow) setSelected(s => Math.max(0, s - 1))
    if (key.downArrow) setSelected(s => Math.min(accounts.length - 1, s + 1))
    if (input === 't' || input === 'T') {
      const acc = accounts[selected]
      if (acc) { appendAuthLog(acc.type, `account toggled id=${acc.id} enabled=${!acc.enabled}`); toggleAccount(acc.id, !acc.enabled); refresh() }
    }
    if (input === 'd' || input === 'D') {
      setConfirmRemove(true)
    }
  })

  if (accounts.length === 0) {
    return (
      <Box flexDirection="column" gap={1}>
        <Text dimColor>No accounts yet. Add one with "Add account".</Text>
        <Text dimColor>Esc to go back</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" gap={1}>
      <Text bold>Accounts ({accounts.length})</Text>
      {accounts.map((acc, i) => {
        const isSelected = i === selected
        return (
          <Box key={acc.id} gap={1}>
            <Text color="cyan">{isSelected ? '❯' : ' '}</Text>
            <Text color={acc.enabled ? 'green' : 'gray'}>{acc.enabled ? '●' : '○'}</Text>
            <Text bold={isSelected} color={isSelected ? 'white' : undefined}>
              {ACCOUNT_TYPE_LABELS[acc.type]}
            </Text>
            <Text dimColor>{acc.email ?? acc.label}</Text>
          </Box>
        )
      })}
      <Box marginTop={1}>
        {confirmRemove ? (
          <Text color="red">Remove <Text bold>{accounts[selected]?.email ?? accounts[selected]?.label}</Text>? [y/N]</Text>
        ) : (
          <Text dimColor>↑↓ select · T toggle on/off · D delete · Esc back</Text>
        )}
      </Box>
    </Box>
  )
}

// ─── Main auth command ─────────────────────────────────────────────────────────
function AuthCommand({
  onDone,
  context,
}: {
  onDone: (msg?: string) => void
  context: LocalJSXCommandContext
}) {
  const [step, setStep] = useState<Step>({ name: 'menu' })
  const accountCount = loadAccounts().accounts.length

  if (step.name === 'menu') {
    return (
      <Dialog title="snowcode — accounts" onCancel={() => onDone()} color="permission">
        <Box flexDirection="column" gap={1}>
          <Text dimColor>{accountCount} account{accountCount !== 1 ? 's' : ''} configured</Text>
          <Select
            options={[
              { value: 'add',    label: 'Add account',     description: 'Add a new provider credential' },
              { value: 'manage', label: 'Manage accounts', description: 'Toggle or remove existing accounts' },
            ]}
            onChange={(v: string) => {
              if (v === 'add')    setStep({ name: 'add_pick_type' })
              if (v === 'manage') setStep({ name: 'manage' })
            }}
          />
        </Box>
      </Dialog>
    )
  }

  if (step.name === 'manage') {
    return (
      <Dialog title="Manage accounts" onCancel={() => setStep({ name: 'menu' })} color="permission">
        <ManageAccounts onBack={() => setStep({ name: 'menu' })} />
      </Dialog>
    )
  }

  if (step.name === 'add_pick_type') {
    return (
      <Dialog title="Add account — choose type" onCancel={() => setStep({ name: 'menu' })} color="permission">
        <Box flexDirection="column" gap={1}>
          <Text dimColor>You can add unlimited accounts per provider.</Text>
          <Select
            options={ADD_TYPE_OPTIONS}
            onChange={(type: AccountType) => {
              appendAuthLog(type, 'auth flow selected')
              if (type === 'anthropic_oauth') setStep({ name: 'claudeai_oauth' })
              else if (type === 'google_oauth') setStep({ name: 'google_oauth' })
              else if (type === 'codex_oauth') setStep({ name: 'codex_oauth' })
              else {
                const opt = ADD_TYPE_OPTIONS.find(o => o.value === type)!
                setStep({ name: 'apikey', accountType: type, label: opt.label })
              }
            }}
          />
        </Box>
      </Dialog>
    )
  }

  // ── Claude.ai OAuth ──────────────────────────────────────────────────────────
  if (step.name === 'claudeai_oauth') {
    return (
      <Dialog title="Add — Claude.ai OAuth" onCancel={() => setStep({ name: 'add_pick_type' })} color="permission">
        <ConsoleOAuthFlow
          mode="login"
          onDone={() => {
            appendAuthLog('anthropic_oauth', 'Claude.ai OAuth success')
            context.onChangeAPIKey()
            context.setMessages(stripSignatureBlocks)
            context.setAppState(prev => ({ ...prev, authVersion: prev.authVersion + 1 }))
            // Capture email + refreshToken from the just-installed tokens so /usage can query per-account
            const freshTokens = getClaudeAIOAuthTokens()
            const email = freshTokens ? (freshTokens as any).emailAddress ?? (freshTokens as any).email ?? null : null
            const label = email ? `Claude.ai (${email})` : 'Claude.ai OAuth'
            const newAccount = addAccount({ type: 'anthropic_oauth', label, enabled: true })
            if (freshTokens?.refreshToken) {
              updateAccount(newAccount.id, { refreshToken: freshTokens.refreshToken, ...(email ? { email } : {}) })
            }
            onDone('Claude.ai OAuth account added')
          }}
          forceLoginMethod="claudeai"
        />
      </Dialog>
    )
  }

  // ── Google / Antigravity OAuth ───────────────────────────────────────────────
  if (step.name === 'google_oauth') {
    const oauth = assertAntigravityOAuthConfig()
    return (
      <Dialog title="Add — Antigravity / Google OAuth" onCancel={() => setStep({ name: 'add_pick_type' })} color="permission">
        <OAuthFlow
          title="Google"
          service="google_oauth"
          port={AG_PORT}
          callbackPath="/oauth-callback"
          buildAuthUrl={(state, challenge) =>
            `${AG_AUTH_URL}?` + new URLSearchParams({
              client_id: oauth.clientId, redirect_uri: AG_REDIRECT_URI,
              response_type: 'code', scope: AG_SCOPES, state,
              code_challenge: challenge, code_challenge_method: 'S256',
              access_type: 'offline', prompt: 'consent',
            }).toString()
          }
          doExchange={async (code, verifier) => {
            const tokens = await exchangeTokens(AG_TOKEN_URL, {
              code, client_id: oauth.clientId, client_secret: oauth.clientSecret,
              redirect_uri: AG_REDIRECT_URI, grant_type: 'authorization_code', code_verifier: verifier,
            }, 'google_oauth')
            const email = await fetchGoogleEmail(tokens.access_token, tokens.id_token)
            const { projectId } = await fetchGoogleProjectId(tokens.access_token)
            return {
              email,
              refreshToken: tokens.refresh_token ?? '',
              completionMessage: `Google login succeeded: ${email}`,
              pendingGoogleProjectSetup: {
                email,
                refreshToken: tokens.refresh_token ?? '',
                suggestedProjectId: projectId || undefined,
              },
            }
          }}
          onDone={(result) => {
            if (result?.pendingGoogleProjectSetup) {
              setStep({
                name: 'google_project_setup',
                email: result.pendingGoogleProjectSetup.email,
                refreshToken: result.pendingGoogleProjectSetup.refreshToken,
                suggestedProjectId: result.pendingGoogleProjectSetup.suggestedProjectId,
              })
              return
            }
            onDone(
              result
                ? (result.completionMessage ?? `Google account added: ${result.email}`)
                : undefined,
            )
          }}
        />
      </Dialog>
    )
  }

  if (step.name === 'google_project_setup') {
    return (
      <Dialog title="Add — Antigravity / Google Project" onCancel={() => setStep({ name: 'add_pick_type' })} color="permission" hideInputGuide={true} isCancelActive={false}>
        <GoogleProjectInput
          email={step.email}
          refreshToken={step.refreshToken}
          suggestedProjectId={step.suggestedProjectId}
          onSaved={(msg) => onDone(msg)}
          onBack={() => setStep({ name: 'add_pick_type' })}
        />
      </Dialog>
    )
  }

  // ── Codex / OpenAI OAuth ─────────────────────────────────────────────────────
  if (step.name === 'codex_oauth') {
    return (
      <Dialog title="Add — OpenAI Codex OAuth" onCancel={() => setStep({ name: 'add_pick_type' })} color="permission">
        <OAuthFlow
          title="OpenAI Codex"
          service="codex_oauth"
          port={CODEX_PORT}
          callbackPath="/auth/callback"
          buildAuthUrl={(state, challenge) =>
            `${CODEX_AUTH_URL}?` + new URLSearchParams({
              client_id: CODEX_CLIENT_ID, redirect_uri: CODEX_REDIRECT_URI,
              response_type: 'code', scope: CODEX_SCOPES, state,
              code_challenge: challenge, code_challenge_method: 'S256',
              access_type: 'offline', prompt: 'consent',
            }).toString()
          }
          doExchange={async (code, verifier) => {
            const tokens = await exchangeTokens(CODEX_TOKEN_URL, {
              code, client_id: CODEX_CLIENT_ID,
              redirect_uri: CODEX_REDIRECT_URI, grant_type: 'authorization_code', code_verifier: verifier,
            }, 'codex_oauth')
            const email = emailFromTokens(tokens)
            addAccount({ type: 'codex_oauth', label: `Codex: ${email}`, email, refreshToken: tokens.refresh_token, enabled: true })
            process.env.OPENAI_API_KEY = 'chatgpt-oauth'
            appendAuthLog('codex_oauth', `account saved email=${email}`)
            return { email, refreshToken: tokens.refresh_token ?? '' }
          }}
          onDone={(result) => onDone(result ? `Codex account added: ${result.email}` : undefined)}
        />
      </Dialog>
    )
  }

  // ── API key ──────────────────────────────────────────────────────────────────
  if (step.name === 'apikey') {
    const { accountType, label } = step
    const envVar = API_KEY_ENV[accountType]
    return (
      <Dialog
        title={`Add — ${label}`}
        onCancel={() => setStep({ name: 'add_pick_type' })}
        color="permission"
        hideInputGuide={true}
        isCancelActive={false}
      >
        <ApiKeyInput
          label={label}
          envVar={envVar}
          accountType={accountType}
          onSaved={(msg) => onDone(msg)}
          onBack={() => setStep({ name: 'add_pick_type' })}
        />
      </Dialog>
    )
  }

  return null
}

// ─── Command entry point ───────────────────────────────────────────────────────
export async function call(
  onDone: LocalJSXCommandOnDone,
  context: LocalJSXCommandContext,
): Promise<React.ReactNode> {
  return <AuthCommand onDone={(msg) => onDone(msg)} context={context} />
}
