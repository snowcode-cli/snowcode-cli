/**
 * snowcode model config — reads/writes ~/.snowcode/models.json
 * Models are stored as "provider:model" strings, e.g. "anthropic:claude-sonnet-4-6"
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getClaudeConfigHomeDir } from './envUtils.js'
import type { ModelOption } from './model/modelOptions.js'
import { MODEL_PROVIDER_LABELS } from './model/providerMetadata.js'

const DEFAULT_CODEX_MODELS = [
  'codex:gpt-5.2-codex',
  'codex:gpt-5.1-codex-max',
  'codex:gpt-5.1-codex',
  'codex:gpt-5-codex',
  'codex:gpt-5.4',
  'codex:gpt-5.1-codex-mini',
  'codex:codex-mini-latest',
  'codex:gpt-5.3-codex-spark',
  'codex:codex-plan',
  'codex:codex-spark',
] as const

export const DEFAULT_MODELS: string[] = [
  'anthropic:claude-sonnet-4-6',
  'anthropic:claude-opus-4-6',
  'anthropic:claude-haiku-4-5',
  'openai:gpt-4.1',
  'openai:gpt-4.1-mini',
  'openai:gpt-4.1-nano',
  'openai:o4-mini',
  'openai:o3',
  'vertex:gemini-2.5-pro',
  'vertex:gemini-2.5-flash',
  'vertex:gemini-3-flash-preview',
  'vertex:gemini-3-pro-preview',
  'zai:glm-5.1',
  'zai:glm-4.7',
  'zai:glm-4.7-flash',
  'zai:glm-4.7-flashx',
  'antigravity:gemini-3-flash',
  'antigravity:gemini-3-pro-high',
  'antigravity:gemini-3.1-pro',
  'antigravity:claude-sonnet-4-6',
  'antigravity:claude-opus-4-6-thinking',
  'gemini:gemini-2.5-flash',
  'gemini:gemini-2.5-pro',
  'gemini:gemini-3-flash-preview',
  'gemini:gemini-3-pro-preview',
  'gemini:gemini-3.1-pro-preview',
  'gemini:gemini-3.1-pro-preview-customtools',
  ...DEFAULT_CODEX_MODELS,
]

function getModelsPath(): string {
  return join(getClaudeConfigHomeDir(), 'models.json')
}

export function loadModelConfig(): string[] {
  const path = getModelsPath()
  if (!existsSync(path)) {
    const dir = getClaudeConfigHomeDir()
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(path, JSON.stringify(DEFAULT_MODELS, null, 2))
    return DEFAULT_MODELS
  }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8'))
    if (Array.isArray(parsed)) return parsed as string[]
  } catch {}
  return DEFAULT_MODELS
}

export function modelStringToOption(str: string): ModelOption {
  const colonIdx = str.indexOf(':')
  if (colonIdx === -1) {
    return { value: str, label: str, description: str }
  }
  const provider = str.slice(0, colonIdx)
  const model = str.slice(colonIdx + 1)
  const providerLabel = MODEL_PROVIDER_LABELS[provider] ?? provider
  return {
    value: str,
    label: `${providerLabel}:${model}`,
    description: `${providerLabel} · ${model}`,
  }
}

export function getConfigModelOptions(): ModelOption[] {
  return loadModelConfig().map(modelStringToOption)
}

