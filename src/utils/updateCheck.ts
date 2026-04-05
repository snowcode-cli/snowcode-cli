/**
 * Update check — fetches latest version from npm, caches result for 24h.
 * Cache stored at ~/.snowcode/update-check.json
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { getClaudeConfigHomeDir } from './envUtils.js'

declare const MACRO: { DISPLAY_VERSION?: string; VERSION: string }

const PKG_NAME = 'snowcode'
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000 // 24 hours
const require = createRequire(import.meta.url)

export type UpdateCache = { latestVersion: string; checkedAt: number }

function normalizeVersion(version: string): number[] {
  return version
    .replace(/[^0-9.]/g, '')
    .split('.')
    .filter(Boolean)
    .map(part => Number(part) || 0)
}

export function compareVersions(a: string, b: string): number {
  const av = normalizeVersion(a)
  const bv = normalizeVersion(b)
  const len = Math.max(av.length, bv.length, 3)
  for (let i = 0; i < len; i++) {
    const ai = av[i] ?? 0
    const bi = bv[i] ?? 0
    if (ai > bi) return 1
    if (ai < bi) return -1
  }
  return 0
}

export function getCurrentVersion(): string {
  const displayVersion =
    (typeof MACRO !== 'undefined'
      ? (MACRO.DISPLAY_VERSION ?? MACRO.VERSION)
      : undefined) ??
    (() => {
      try {
        const pkg = require('../../package.json') as { version?: string }
        return pkg.version
      } catch {
        return undefined
      }
    })() ??
    '0.0.0'
  return displayVersion.replace(/[^0-9.]/g, '') || '0.0.0'
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

export function isUpdateCacheFresh(
  cache: UpdateCache | null,
  now: number = Date.now(),
): boolean {
  return Boolean(cache && now - cache.checkedAt < CHECK_INTERVAL_MS)
}

async function fetchLatestVersion(timeoutMs: number): Promise<string | null> {
  try {
    const res = await fetch(`https://registry.npmjs.org/${PKG_NAME}/latest`, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) return null
    const data = (await res.json()) as { version?: string }
    return typeof data.version === 'string' ? data.version : null
  } catch {
    return null
  }
}

/** Returns the latest version if there is a newer one, else null */
export function getAvailableUpdate(cache: UpdateCache | null): string | null {
  if (!cache) return null
  return compareVersions(cache.latestVersion, getCurrentVersion()) > 0
    ? cache.latestVersion
    : null
}

export async function refreshUpdateCache(options?: {
  force?: boolean
  timeoutMs?: number
}): Promise<UpdateCache | null> {
  const cache = readUpdateCache()
  const currentVersion = getCurrentVersion()
  const canReuseFreshCache =
    isUpdateCacheFresh(cache) &&
    (!cache || compareVersions(cache.latestVersion, currentVersion) >= 0)

  if (!options?.force && canReuseFreshCache) {
    return cache
  }

  const latestVersion = await fetchLatestVersion(options?.timeoutMs ?? 5000)
  if (!latestVersion) {
    return cache
  }

  const nextCache = {
    latestVersion,
    checkedAt: Date.now(),
  }
  writeUpdateCache(nextCache)
  return nextCache
}

export async function getAvailableUpdateWithRefresh(options?: {
  force?: boolean
  timeoutMs?: number
}): Promise<string | null> {
  const cache = await refreshUpdateCache(options)
  return getAvailableUpdate(cache)
}

/** Fire-and-forget: fetch npm registry in background, update cache */
export function checkForUpdateInBackground(): void {
  void refreshUpdateCache()
}
