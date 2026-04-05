import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

type AntigravityVersionState = {
  version: string
  commit?: string
  source: 'fallback' | 'local' | 'remote'
  updatedAt: number
}

const FALLBACK_VERSION = '1.107.0'
const REMOTE_VERSION_SOURCES = [
  'https://antigravity-auto-updater-974169037036.us-central1.run.app',
  'https://antigravity.google/changelog',
] as const
const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000

let state: AntigravityVersionState = {
  version: FALLBACK_VERSION,
  source: 'fallback',
  updatedAt: Date.now(),
}
let initStarted = false
let refreshPromise: Promise<void> | undefined

function appDataAntigravityDir(): string {
  return process.env.APPDATA
    ? join(process.env.APPDATA, 'Antigravity')
    : join(homedir(), 'AppData', 'Roaming', 'Antigravity')
}

function parseVersionFromText(input: string): string | undefined {
  const jsonVersion =
    input.match(/"version"\s*:\s*"(\d+\.\d+\.\d+)"/)?.[1] ??
    input.match(/\b(\d+\.\d+\.\d+)\b/)?.[1]
  return jsonVersion?.trim()
}

function parseCommitFromText(input: string): string | undefined {
  return input.match(/"productCommit"\s*:\s*"([0-9a-f]{8,40})"/i)?.[1]?.trim()
}

function readLatestSharedprocessVersion(baseDir: string): string | undefined {
  const logsDir = join(baseDir, 'logs')
  if (!existsSync(logsDir)) return undefined

  const latestLogDir = readdirSync(logsDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort()
    .at(-1)

  if (!latestLogDir) return undefined

  const sharedprocessLog = join(logsDir, latestLogDir, 'sharedprocess.log')
  if (!existsSync(sharedprocessLog)) return undefined

  return parseVersionFromText(readFileSync(sharedprocessLog, 'utf8'))
}

function readCachedProfileCommit(baseDir: string): string | undefined {
  const candidate = join(
    baseDir,
    'CachedProfilesData',
    '__default__profile__',
    'extensions.user.cache',
  )
  if (!existsSync(candidate)) return undefined
  return parseCommitFromText(readFileSync(candidate, 'utf8'))
}

function readInstalledAntigravityVersion(): Partial<AntigravityVersionState> {
  try {
    const baseDir = appDataAntigravityDir()
    const version = readLatestSharedprocessVersion(baseDir)
    const commit = readCachedProfileCommit(baseDir)
    if (!version && !commit) return {}
    return {
      version: version ?? state.version,
      commit,
      source: 'local',
      updatedAt: Date.now(),
    }
  } catch {
    return {}
  }
}

function parseRemoteVersionPayload(input: string): string | undefined {
  const jsonCandidates = [
    /"version"\s*:\s*"(\d+\.\d+\.\d+)"/,
    /"latestVersion"\s*:\s*"(\d+\.\d+\.\d+)"/,
    /"productVersion"\s*:\s*"(\d+\.\d+\.\d+)"/,
  ]
  for (const pattern of jsonCandidates) {
    const match = input.match(pattern)
    if (match?.[1]) return match[1]
  }

  const changelogMatch =
    input.match(/\b(?:version|v)\s*(\d+\.\d+\.\d+)\b/i) ??
    input.match(/\b(\d+\.\d+\.\d+)\b/)
  return changelogMatch?.[1]
}

async function fetchLatestRemoteVersion(): Promise<string | undefined> {
  for (const url of REMOTE_VERSION_SOURCES) {
    try {
      const response = await fetch(url, { redirect: 'follow' })
      if (!response.ok) continue
      const body = await response.text()
      const parsed = parseRemoteVersionPayload(body)
      if (parsed) return parsed
    } catch {
    }
  }
  return undefined
}

async function refreshAntigravityVersion(): Promise<void> {
  const remoteVersion = await fetchLatestRemoteVersion()
  if (!remoteVersion) return
  state = {
    version: remoteVersion,
    commit: state.commit,
    source: 'remote',
    updatedAt: Date.now(),
  }
}

export function initAntigravityVersion(): Promise<void> {
  if (!initStarted) {
    initStarted = true
    const installed = readInstalledAntigravityVersion()
    if (installed.version || installed.commit) {
      state = {
        version: installed.version ?? state.version,
        commit: installed.commit ?? state.commit,
        source: installed.source ?? 'local',
        updatedAt: installed.updatedAt ?? Date.now(),
      }
    }
  }

  const isFresh = Date.now() - state.updatedAt < REFRESH_INTERVAL_MS
  if (refreshPromise || isFresh) {
    return refreshPromise ?? Promise.resolve()
  }

  refreshPromise = refreshAntigravityVersion().finally(() => {
    refreshPromise = undefined
  })
  return refreshPromise
}

export function getAntigravityVersionState(): AntigravityVersionState {
  void initAntigravityVersion().catch(() => {})
  return state
}
