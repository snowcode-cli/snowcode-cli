import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { getCwd } from '../../utils/cwd.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'

export type CompactScopeState = {
  lastCompactAt?: string
  lastCompactInputTokens?: number
  lastCompactSavedTokens?: number
}

type CompactStateFile = {
  version: 1
  scopes: Record<string, CompactScopeState>
}

const EMPTY_STATE: CompactStateFile = {
  version: 1,
  scopes: {},
}

function getCompactStatePath(): string {
  return join(getClaudeConfigHomeDir(), 'compact-state.json')
}

function ensureCompactStateDir(): void {
  const dir = getClaudeConfigHomeDir()
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

function getScopeKey(model: string, cwd = getCwd()): string {
  return `${resolve(cwd)}::${model}`
}

function loadCompactStateFile(): CompactStateFile {
  const path = getCompactStatePath()
  if (!existsSync(path)) {
    return EMPTY_STATE
  }

  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as CompactStateFile
    if (
      parsed &&
      parsed.version === 1 &&
      parsed.scopes &&
      typeof parsed.scopes === 'object'
    ) {
      return parsed
    }
  } catch {
    // Ignore invalid state and recreate on next write.
  }

  return EMPTY_STATE
}

function saveCompactStateFile(data: CompactStateFile): void {
  ensureCompactStateDir()
  writeFileSync(getCompactStatePath(), JSON.stringify(data, null, 2), 'utf8')
}

export function getCompactScopeState(
  model: string,
  cwd?: string,
): CompactScopeState | undefined {
  const state = loadCompactStateFile()
  return state.scopes[getScopeKey(model, cwd)]
}

export function recordCompactScopeState(
  model: string,
  update: CompactScopeState,
  cwd?: string,
): void {
  const state = loadCompactStateFile()
  const key = getScopeKey(model, cwd)
  state.scopes[key] = {
    ...state.scopes[key],
    ...update,
  }
  saveCompactStateFile(state)
}
