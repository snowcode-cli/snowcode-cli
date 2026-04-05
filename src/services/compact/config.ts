import { getSettings_DEPRECATED } from '../../utils/settings/settings.js'

type CompactSettings = {
  compactModel?: unknown
  autoCompactWindowTokens?: unknown
}

function normalizeNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function parsePositiveInteger(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value > 0 ? value : null
  }

  if (typeof value !== 'string') return null

  const trimmed = value.trim()
  if (!/^\d+$/.test(trimmed)) return null

  const parsed = Number.parseInt(trimmed, 10)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

function getCompactSettings(): CompactSettings {
  return (getSettings_DEPRECATED() ?? {}) as CompactSettings
}

export function resolveConfiguredCompactModel(
  mainLoopModel: string,
  overrides?: {
    envCompactModel?: unknown
    settingsCompactModel?: unknown
  },
): string {
  return (
    normalizeNonEmptyString(overrides?.envCompactModel) ??
    normalizeNonEmptyString(overrides?.settingsCompactModel) ??
    mainLoopModel
  )
}

export function resolveConfiguredAutoCompactWindowTokens(overrides?: {
  envAutoCompactWindow?: unknown
  settingsAutoCompactWindow?: unknown
}): number | null {
  return (
    parsePositiveInteger(overrides?.envAutoCompactWindow) ??
    parsePositiveInteger(overrides?.settingsAutoCompactWindow)
  )
}

export function getConfiguredCompactModel(mainLoopModel: string): string {
  const settings = getCompactSettings()
  return resolveConfiguredCompactModel(mainLoopModel, {
    envCompactModel: process.env.CLAUDE_CODE_COMPACT_MODEL,
    settingsCompactModel: settings.compactModel,
  })
}

export function getConfiguredAutoCompactWindowTokens(): number | null {
  const settings = getCompactSettings()
  return resolveConfiguredAutoCompactWindowTokens({
    envAutoCompactWindow: process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW,
    settingsAutoCompactWindow: settings.autoCompactWindowTokens,
  })
}
