import { getAPIProvider } from '../utils/model/providers.js'
import { resolveProviderRequest } from './api/providerConfig.js'
import { shouldProcessMockLimits } from './rateLimitMocking.js'

export function shouldShowClaudeAiLimitsForModel(model?: string): boolean {
  if (shouldProcessMockLimits()) {
    return true
  }

  if (!model) {
    return getAPIProvider() === 'firstParty'
  }

  const resolved = resolveProviderRequest({ model })

  if (resolved.transport === 'codex_responses') {
    return false
  }

  if (resolved.providerPrefix !== undefined) {
    return resolved.providerPrefix === 'anthropic'
  }

  return getAPIProvider() === 'firstParty'
}
