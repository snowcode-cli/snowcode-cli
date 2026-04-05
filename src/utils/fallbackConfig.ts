/**
 * Fallback provider order config — stored in ~/.snowcode/fallbacks.json
 * Each entry is an account ID (from accountManager).
 * The first account in the list is used as the auto-fallback when rate-limited.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getClaudeConfigHomeDir } from './envUtils.js'

export interface FallbackConfig {
  /** Account IDs in priority order */
  order: string[]
}

function getPath(): string {
  return join(getClaudeConfigHomeDir(), 'fallbacks.json')
}

export function loadFallbackConfig(): FallbackConfig {
  const path = getPath()
  if (!existsSync(path)) return { order: [] }
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as FallbackConfig
  } catch {
    return { order: [] }
  }
}

export function saveFallbackConfig(config: FallbackConfig): void {
  writeFileSync(getPath(), JSON.stringify(config, null, 2), 'utf-8')
}

export function getFallbackOrder(): string[] {
  return loadFallbackConfig().order
}

export function setFallbackOrder(order: string[]): void {
  saveFallbackConfig({ order })
}

export function addToFallback(accountId: string): void {
  const config = loadFallbackConfig()
  if (!config.order.includes(accountId)) {
    config.order.push(accountId)
    saveFallbackConfig(config)
  }
}

export function removeFromFallback(accountId: string): void {
  const config = loadFallbackConfig()
  config.order = config.order.filter(id => id !== accountId)
  saveFallbackConfig(config)
}

export function moveFallback(accountId: string, direction: 'up' | 'down'): void {
  const config = loadFallbackConfig()
  const idx = config.order.indexOf(accountId)
  if (idx === -1) return
  const newIdx = direction === 'up' ? idx - 1 : idx + 1
  if (newIdx < 0 || newIdx >= config.order.length) return
  ;[config.order[idx], config.order[newIdx]] = [config.order[newIdx]!, config.order[idx]!]
  saveFallbackConfig(config)
}
