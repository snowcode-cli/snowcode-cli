export const MODEL_PROVIDER_LABELS = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
  zai: 'Z.AI',
  antigravity: 'Antigravity',
  codex: 'Codex',
  vertex: 'Vertex',
  gemini: 'Gemini',
} as const

export type ModelProviderPrefix = keyof typeof MODEL_PROVIDER_LABELS

export function isModelProviderPrefix(
  value: string,
): value is ModelProviderPrefix {
  return Object.prototype.hasOwnProperty.call(MODEL_PROVIDER_LABELS, value)
}

export function getModelProviderPrefix(
  model: string,
): ModelProviderPrefix | undefined {
  const separator = model.indexOf(':')
  if (separator <= 0) return undefined

  const prefix = model.slice(0, separator).trim().toLowerCase()
  return isModelProviderPrefix(prefix) ? prefix : undefined
}

export function stripModelProviderPrefix(model: string): string {
  const prefix = getModelProviderPrefix(model)
  return prefix ? model.slice(prefix.length + 1) : model
}

export function stripModelQueryString(model: string): string {
  const queryIndex = model.indexOf('?')
  return queryIndex === -1 ? model : model.slice(0, queryIndex)
}

export function getProviderScopedBaseModel(model: string): string {
  return stripModelQueryString(stripModelProviderPrefix(model)).trim()
}

export function getModelProviderLabel(
  prefix: string | undefined,
): string | undefined {
  return prefix && isModelProviderPrefix(prefix)
    ? MODEL_PROVIDER_LABELS[prefix]
    : undefined
}
