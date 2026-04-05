import { getSettings_DEPRECATED } from '../../utils/settings/settings.js'

type CompactSettings = {
  compactModel?: unknown
  autoCompactWindowTokens?: unknown
  autoCompactMilestones?: unknown
  compactMinGainTokens?: unknown
  compactCooldownMinutes?: unknown
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

function parseNonNegativeInteger(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value >= 0 ? value : null
  }

  if (typeof value !== 'string') return null

  const trimmed = value.trim()
  if (!/^\d+$/.test(trimmed)) return null

  const parsed = Number.parseInt(trimmed, 10)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
}

function parsePositiveIntegerArray(value: unknown): number[] | null {
  const rawItems = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value
          .split(',')
          .map(item => item.trim())
          .filter(Boolean)
      : null

  if (!rawItems || rawItems.length === 0) return null

  const parsed = rawItems
    .map(item => parsePositiveInteger(item))
    .filter((item): item is number => item !== null)

  if (parsed.length !== rawItems.length) return null

  return [...new Set(parsed)].sort((a, b) => a - b)
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

export function resolveConfiguredAutoCompactMilestones(overrides?: {
  envAutoCompactMilestones?: unknown
  settingsAutoCompactMilestones?: unknown
}): number[] | null {
  return (
    parsePositiveIntegerArray(overrides?.envAutoCompactMilestones) ??
    parsePositiveIntegerArray(overrides?.settingsAutoCompactMilestones)
  )
}

export function resolveConfiguredCompactMinGainTokens(overrides?: {
  envCompactMinGainTokens?: unknown
  settingsCompactMinGainTokens?: unknown
}): number | null {
  return (
    parseNonNegativeInteger(overrides?.envCompactMinGainTokens) ??
    parseNonNegativeInteger(overrides?.settingsCompactMinGainTokens)
  )
}

export function resolveConfiguredCompactCooldownMinutes(overrides?: {
  envCompactCooldownMinutes?: unknown
  settingsCompactCooldownMinutes?: unknown
}): number | null {
  return (
    parseNonNegativeInteger(overrides?.envCompactCooldownMinutes) ??
    parseNonNegativeInteger(overrides?.settingsCompactCooldownMinutes)
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

export function getConfiguredAutoCompactMilestones(): number[] {
  const settings = getCompactSettings()
  return (
    resolveConfiguredAutoCompactMilestones({
      envAutoCompactMilestones:
        process.env.CLAUDE_CODE_AUTO_COMPACT_MILESTONES,
      settingsAutoCompactMilestones: settings.autoCompactMilestones,
    }) ?? []
  )
}

export function getConfiguredCompactMinGainTokens(): number | null {
  const settings = getCompactSettings()
  return resolveConfiguredCompactMinGainTokens({
    envCompactMinGainTokens: process.env.CLAUDE_CODE_COMPACT_MIN_GAIN_TOKENS,
    settingsCompactMinGainTokens: settings.compactMinGainTokens,
  })
}

export function getConfiguredCompactCooldownMinutes(): number | null {
  const settings = getCompactSettings()
  return resolveConfiguredCompactCooldownMinutes({
    envCompactCooldownMinutes:
      process.env.CLAUDE_CODE_COMPACT_COOLDOWN_MINUTES,
    settingsCompactCooldownMinutes: settings.compactCooldownMinutes,
  })
}
