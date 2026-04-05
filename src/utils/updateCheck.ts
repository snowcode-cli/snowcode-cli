/**
 * Update check — fetches latest version from npm, caches result for 24h.
 * Cache stored at ~/.snowcode/update-check.json
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getClaudeConfigHomeDir } from './envUtils.js'

declare const MACRO: { DISPLAY_VERSION?: string; VERSION: string }

const PKG_NAME = 'snowcode'
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000 // 24 hours

type UpdateCache = { latestVersion: string; checkedAt: number }

export function getCurrentVersion(): string {
  return (MACRO.DISPLAY_VERSION ?? MACRO.VERSION ?? '0.0.0').replace(/[^0-9.]/g, '') || '0.0.0'
}

function cachePath(): string {
  return join(getClaudeConfigHomeDir(), 'update-check.json')
}

export function readUpdateCache(): UpdateCache | null {
  try {
    const p = cachePath()
    if (!existsSync(p)) return null
    return JSON.parse(readFileSync(p, 'utf-8')) as UpdateCache
  } catch {
    return null
  }
}

function writeUpdateCache(cache: UpdateCache): void {
  try {
    const dir = getClaudeConfigHomeDir()
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(cachePath(), JSON.stringify(cache))
  } catch {}
}

/** Returns the latest version if there is a newer one, else null */
export function getAvailableUpdate(cache: UpdateCache | null): string | null {
  if (!cache) return null
  const cur = getCurrentVersion().split('.').map(Number)
  const lat = cache.latestVersion.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const c = cur[i] ?? 0
    const l = lat[i] ?? 0
    if (l > c) return cache.latestVersion
    if (c > l) return null
  }
  return null
}

/** Fire-and-forget: fetch npm registry in background, update cache */
export function checkForUpdateInBackground(): void {
  const cache = readUpdateCache()
  const now = Date.now()
  if (cache && now - cache.checkedAt < CHECK_INTERVAL_MS) return

  // Deliberately not awaited — runs in background
  void (async () => {
    try {
      const res = await fetch(`https://registry.npmjs.org/${PKG_NAME}/latest`, {
        signal: AbortSignal.timeout(5000),
        headers: { Accept: 'application/json' },
      })
      if (!res.ok) return
      const data = (await res.json()) as { version: string }
      if (typeof data.version === 'string') {
        writeUpdateCache({ latestVersion: data.version, checkedAt: Date.now() })
      }
    } catch {}
  })()
}
