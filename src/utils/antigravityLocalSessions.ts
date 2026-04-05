import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { platform } from 'node:os'
import { getClaudeConfigHomeDir } from './envUtils.js'

export type AntigravityLocalSession = {
  email: string
  name: string | null
  accessToken: string | null
  refreshToken: string | null
  updatedAt: string
  authStatusRaw?: string | null
  oauthTokenRaw?: string | null
  userStatusRaw?: string | null
}

export type RestoreAntigravityLocalSessionResult = {
  ok: boolean
  reason:
    | 'unsupported_platform'
    | 'snapshot_not_found'
    | 'snapshot_incomplete'
    | 'sqlite_write_failed'
    | 'restart_failed'
    | 'restored'
}

type SessionFile = {
  version: 1
  sessions: AntigravityLocalSession[]
}

function getSnapshotPath() {
  return join(getClaudeConfigHomeDir(), 'antigravity-local-sessions.json')
}

function loadSnapshotFile(): SessionFile {
  const path = getSnapshotPath()
  if (!existsSync(path)) return { version: 1, sessions: [] }
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as SessionFile
  } catch {
    return { version: 1, sessions: [] }
  }
}

function saveSnapshotFile(data: SessionFile) {
  const dir = getClaudeConfigHomeDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(getSnapshotPath(), JSON.stringify(data, null, 2), 'utf8')
}

function extractRefreshToken(oauthTokenValue: string | null | undefined) {
  const raw = oauthTokenValue?.trim()
  if (!raw) return null
  try {
    const decoded = Buffer.from(raw, 'base64').toString('utf8')
    const match = decoded.match(/1\/\/[A-Za-z0-9._-]+/)
    return match?.[0] ?? null
  } catch {
    return null
  }
}

function runPythonSqliteProbe() {
  const pythonScript = `
import base64, json, os, sqlite3
path = os.path.expandvars(r'%APPDATA%\\\\Antigravity\\\\User\\\\globalStorage\\\\state.vscdb')
if not os.path.exists(path):
    print(json.dumps({"ok": False, "reason": "missing"}))
    raise SystemExit(0)
conn = sqlite3.connect(path)
cur = conn.cursor()
keys = {}
for key in [
    "antigravityAuthStatus",
    "antigravityUnifiedStateSync.oauthToken",
    "antigravityUnifiedStateSync.userStatus",
]:
    cur.execute("SELECT value FROM ItemTable WHERE key=?", (key,))
    row = cur.fetchone()
    keys[key] = row[0] if row else None
conn.close()
auth_raw = keys.get("antigravityAuthStatus") or ""
auth = {}
if auth_raw:
    try:
        auth = json.loads(auth_raw)
    except Exception:
        auth = {}
payload = {
    "ok": True,
    "path": path,
    "email": (auth.get("email") or "").strip(),
    "name": (auth.get("name") or "").strip(),
    "apiKey": (auth.get("apiKey") or "").strip(),
    "raw": {
        key: (base64.b64encode((value or "").encode("utf-8")).decode("ascii") if value is not None else None)
        for key, value in keys.items()
    },
}
print(json.dumps(payload))
`.trim()

  for (const bin of ['py', 'python']) {
    try {
      const stdout = execFileSync(bin, ['-c', pythonScript], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim()
      if (!stdout) continue
      return JSON.parse(stdout) as {
        ok: boolean
        reason?: string
        path?: string
        email?: string
        name?: string
        apiKey?: string
        raw?: Record<string, string | null>
      }
    } catch {
      continue
    }
  }
  return null
}

export function syncAntigravityLocalSessions(): AntigravityLocalSession[] {
  const existing = loadSnapshotFile()
  if (platform() !== 'win32') return existing.sessions

  const probed = runPythonSqliteProbe()
  if (!probed?.ok || !probed.raw) return existing.sessions

  const email = probed.email?.trim()
  if (!email) return existing.sessions

  const decodeRaw = (value?: string | null) =>
    value ? Buffer.from(value, 'base64').toString('utf8') : null

  const raw = probed.raw ?? {}
  const oauthTokenRaw = decodeRaw(
    raw['antigravityUnifiedStateSync.oauthToken'],
  )
  const session: AntigravityLocalSession = {
    email,
    name: probed.name?.trim() || null,
    accessToken: probed.apiKey?.trim() || null,
    refreshToken: extractRefreshToken(oauthTokenRaw),
    updatedAt: new Date().toISOString(),
    authStatusRaw: decodeRaw(raw.antigravityAuthStatus),
    oauthTokenRaw,
    userStatusRaw: decodeRaw(raw['antigravityUnifiedStateSync.userStatus']),
  }

  const sessions = existing.sessions.filter(item => item.email !== email)
  sessions.push(session)
  saveSnapshotFile({ version: 1, sessions })
  return sessions
}

export function loadAntigravityLocalSessions() {
  return loadSnapshotFile().sessions
}

export function getAntigravityLocalSession(email: string) {
  return loadSnapshotFile().sessions.find(
    session => session.email.toLowerCase() === email.trim().toLowerCase(),
  )
}

function runPythonSqliteWrite(
  authStatusRaw: string,
  oauthTokenRaw: string,
  userStatusRaw: string,
) {
  const pythonScript = `
import os, sqlite3, sys
path = os.path.expandvars(r'%APPDATA%\\\\Antigravity\\\\User\\\\globalStorage\\\\state.vscdb')
conn = sqlite3.connect(path)
cur = conn.cursor()
payload = {
    "antigravityAuthStatus": sys.argv[1],
    "antigravityUnifiedStateSync.oauthToken": sys.argv[2],
    "antigravityUnifiedStateSync.userStatus": sys.argv[3],
}
for key, value in payload.items():
    cur.execute("UPDATE ItemTable SET value=? WHERE key=?", (value, key))
conn.commit()
conn.close()
print("ok")
`.trim()

  for (const bin of ['py', 'python']) {
    try {
      const stdout = execFileSync(
        bin,
        ['-c', pythonScript, authStatusRaw, oauthTokenRaw, userStatusRaw],
        {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      ).trim()
      if (stdout === 'ok') return true
    } catch {
      continue
    }
  }
  return false
}

function restartAntigravityLanguageServers() {
  execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      "Get-Process | Where-Object { $_.ProcessName -eq 'language_server_windows_x64' } | Stop-Process -Force",
    ],
    {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
}

export function restoreAntigravityLocalSession(
  email: string,
): RestoreAntigravityLocalSessionResult {
  const session = getAntigravityLocalSession(email)
  if (platform() !== 'win32') {
    return { ok: false, reason: 'unsupported_platform' }
  }
  if (!session) {
    return { ok: false, reason: 'snapshot_not_found' }
  }
  if (!session.authStatusRaw || !session.oauthTokenRaw || !session.userStatusRaw) {
    return { ok: false, reason: 'snapshot_incomplete' }
  }
  const written = runPythonSqliteWrite(
    session.authStatusRaw,
    session.oauthTokenRaw,
    session.userStatusRaw,
  )
  if (!written) return { ok: false, reason: 'sqlite_write_failed' }
  try {
    restartAntigravityLanguageServers()
  } catch {
    return { ok: false, reason: 'restart_failed' }
  }
  return { ok: true, reason: 'restored' }
}
