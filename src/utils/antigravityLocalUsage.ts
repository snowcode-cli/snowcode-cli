import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir, platform } from 'node:os'

export type AntigravityLocalModelQuota = {
  name: string
  used: number
  resetAt: string | null
}

export type AntigravityLocalUsageSnapshot = {
  email: string
  plan: string | null
  projectId: string | null
  credits: number | null
  monthly: number | null
  models: AntigravityLocalModelQuota[]
  capturedAt: string
}

type SnapshotFile = {
  version: 1
  snapshots: AntigravityLocalUsageSnapshot[]
}

function getConfigDir() {
  return join(homedir(), '.snowcode')
}

function getSnapshotPath() {
  return join(getConfigDir(), 'antigravity-local-usage.json')
}

function loadSnapshots(): SnapshotFile {
  const path = getSnapshotPath()
  if (!existsSync(path)) return { version: 1, snapshots: [] }
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as SnapshotFile
  } catch {
    return { version: 1, snapshots: [] }
  }
}

function saveSnapshots(data: SnapshotFile) {
  const dir = getConfigDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(getSnapshotPath(), JSON.stringify(data, null, 2), 'utf8')
}

function saveSnapshot(snapshot: AntigravityLocalUsageSnapshot) {
  const data = loadSnapshots()
  data.snapshots = data.snapshots.filter(item => item.email.toLowerCase() !== snapshot.email.toLowerCase())
  data.snapshots.push(snapshot)
  saveSnapshots(data)
}

export function getSavedAntigravityLocalUsage(email?: string | null) {
  const snapshots = loadSnapshots().snapshots
  if (!email) return snapshots
  return snapshots.filter(item => item.email.toLowerCase() === email.trim().toLowerCase())
}

export function getAntigravityLocalUsageSnapshotPath() {
  return getSnapshotPath()
}

function getAntigravityLogPath() {
  const root = join(process.env.APPDATA ?? '', 'Antigravity', 'logs')
  if (!existsSync(root)) return null
  const dirs = readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .sort((a, b) => b.name.localeCompare(a.name))
  for (const dir of dirs) {
    const candidate = join(root, dir.name, 'window1', 'exthost', 'google.antigravity', 'Antigravity.log')
    if (existsSync(candidate)) return candidate
  }
  return null
}

function discoverServerFromLog() {
  const logPath = getAntigravityLogPath()
  if (!logPath) return null
  const content = readFileSync(logPath, 'utf8')
  const pidMatches = [...content.matchAll(/Starting language server process with pid (\d+)/g)]
  const portMatches = [...content.matchAll(/Language server listening on (?:random|fixed) port at (\d+) for HTTP/g)]
  const pid = pidMatches.at(-1)?.[1]
  const port = portMatches.at(-1)?.[1]
  if (!pid || !port) return null
  return { pid, port, logPath }
}

function getCommandLineForPid(pid: string) {
  const attempts: Array<() => string> = [
    () =>
      execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-Command',
          `Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" | Select-Object -ExpandProperty CommandLine`,
        ],
        {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      ).trim(),
    () =>
      execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-Command',
          `(Get-WmiObject Win32_Process -Filter "ProcessId=${pid}").CommandLine`,
        ],
        {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      ).trim(),
    () =>
      execFileSync(
        'wmic',
        ['process', 'where', `processid=${pid}`, 'get', 'commandline', '/value'],
        {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      )
        .trim()
        .replace(/^CommandLine=/i, '')
        .trim(),
  ]

  for (const attempt of attempts) {
    try {
      const value = attempt()
      if (value) return value
    } catch {}
  }
  return ''
}

function getCsrfTokenForPid(pid: string) {
  const commandLine = getCommandLineForPid(pid)
  const match = commandLine.match(/--csrf_token\s+([0-9a-f-]+)/i)
  return match?.[1]?.trim() || ''
}

function getExtensionServerInfoForPid(pid: string) {
  const commandLine = getCommandLineForPid(pid)
  const port = commandLine.match(/--extension_server_port\s+(\d+)/i)?.[1]?.trim() || ''
  const csrfToken = commandLine.match(/--extension_server_csrf_token\s+([0-9a-f-]+)/i)?.[1]?.trim() || ''
  return port && csrfToken ? { port, csrfToken } : null
}

function clampPct(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
}

function mapLocalUsage(json: any): AntigravityLocalUsageSnapshot | null {
  const status = json?.userStatus
  if (!status?.email) return null
  const configs = Array.isArray(status?.cascadeModelConfigData?.clientModelConfigs)
    ? status.cascadeModelConfigData.clientModelConfigs
    : []
  const models = configs
    .filter((cfg: any) => cfg?.quotaInfo)
    .map((cfg: any) => {
      const remaining = Number(cfg?.quotaInfo?.remainingFraction ?? 0)
      return {
        name: String(cfg?.label ?? cfg?.name ?? 'unknown'),
        used: clampPct((1 - remaining) * 100),
        resetAt: typeof cfg?.quotaInfo?.resetTime === 'string' ? cfg.quotaInfo.resetTime : null,
      }
    })
  return {
    email: String(status.email),
    plan: status?.userTier?.name ?? status?.planStatus?.planInfo?.name ?? status?.currentTier?.name ?? null,
    projectId: status?.cloudaicompanionProject ?? status?.planStatus?.cloudaicompanionProject ?? json?.projectId ?? null,
    credits: typeof status?.planStatus?.availablePromptCredits === 'number' ? status.planStatus.availablePromptCredits : null,
    monthly: typeof status?.planStatus?.planInfo?.monthlyPromptCredits === 'number' ? status.planStatus.planInfo.monthlyPromptCredits : null,
    models,
    capturedAt: new Date().toISOString(),
  }
}

async function tryFetchAntigravityLocalUsageOnce() {
  if (platform() !== 'win32') throw new Error('local usage only implemented on win32')
  const server = discoverServerFromLog()
  if (!server) throw new Error('could not discover Antigravity language server from logs')
  const csrfToken = getCsrfTokenForPid(server.pid)
  const body = JSON.stringify({
    metadata: { ideName: 'antigravity', extensionName: 'antigravity', locale: 'en' },
  })
  // Fixed-port servers do not pass --csrf_token on the command line — try with empty token too
  const extInfo = getExtensionServerInfoForPid(server.pid)
  const attempts: Array<{ port: string; csrfToken: string; label: string }> = []
  // Primary: language server port, with csrf if available
  attempts.push({ port: server.port, label: 'language_server_http', csrfToken })
  // If no csrf from cmdline, also try with empty token (fixed-port mode)
  if (!csrfToken) {
    attempts.push({ port: server.port, label: 'language_server_http_no_csrf', csrfToken: '' })
  }
  // Extension server port if available
  if (extInfo) {
    attempts.push({ port: extInfo.port, label: 'extension_server_http', csrfToken: extInfo.csrfToken })
  }

  let lastFailure = 'local fetch failed'
  let json: any = null
  for (const attempt of attempts) {
    try {
      const response = await fetch(`http://127.0.0.1:${attempt.port}/exa.language_server_pb.LanguageServerService/GetUserStatus`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Connect-Protocol-Version': '1',
          'X-Codeium-Csrf-Token': attempt.csrfToken,
        },
        body,
      })
      if (!response.ok) {
        const responseBody = await response.text().catch(() => '')
        lastFailure = `${attempt.label} GetUserStatus ${response.status}${responseBody ? `: ${responseBody}` : ''}`
        continue
      }
      json = await response.json().catch(() => null)
      if (json) break
      lastFailure = `${attempt.label} returned empty json`
    } catch (error) {
      lastFailure = `${attempt.label} ${error instanceof Error ? error.message : String(error)}`
    }
  }
  if (!json) {
    throw new Error(lastFailure)
  }
  const snapshot = mapLocalUsage(json)
  if (!snapshot) throw new Error('local GetUserStatus returned no usable userStatus payload')
  saveSnapshot(snapshot)
  return snapshot
}

export async function fetchAntigravityLocalUsage() {
  let lastError: unknown = null
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      return await tryFetchAntigravityLocalUsageOnce()
    } catch (error) {
      lastError = error
      await new Promise(resolve => setTimeout(resolve, attempt * 350))
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}
