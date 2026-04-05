import { expect, test } from 'bun:test'

import {
  coerceReasoningEffort,
  resolveProviderRequest,
} from './providerConfig.js'

test('codex provider prefix routes codex-plan through responses transport', () => {
  const resolved = resolveProviderRequest({ model: 'codex:codex-plan' })

  expect(resolved.transport).toBe('codex_responses')
  expect(resolved.resolvedModel).toBe('gpt-5.4')
  expect(resolved.reasoning).toEqual({ effort: 'high' })
})

test('vertex provider prefix forces vertex transport even for Claude models', () => {
  const resolved = resolveProviderRequest({ model: 'vertex:claude-sonnet-4-6' })

  expect(resolved.transport).toBe('vertex_generate_content')
  expect(resolved.baseUrl).toBe('https://aiplatform.googleapis.com/v1')
  expect(resolved.resolvedModel).toBe('claude-sonnet-4-6')
})

test('runtime effort override beats model defaults for openai-prefixed models', () => {
  const resolved = resolveProviderRequest({
    model: 'openai:gpt-5.4?reasoning=high',
    effort: 'medium',
  })

  expect(resolved.transport).toBe('chat_completions')
  expect(resolved.resolvedModel).toBe('gpt-5.4')
  expect(resolved.reasoning).toEqual({ effort: 'medium' })
})

test('max effort coerces down to high for third-party reasoning backends', () => {
  expect(coerceReasoningEffort('max')).toBe('high')
})
