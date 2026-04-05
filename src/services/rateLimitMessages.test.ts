import { afterEach, expect, test } from 'bun:test'

import {
  emitStatusChange,
  getCurrentClaudeAiLimits,
  type ClaudeAILimits,
} from './claudeAiLimits.js'
import { getRateLimitWarning } from './rateLimitMessages.js'

const originalEnv = {
  CLAUDE_CODE_USE_GEMINI: process.env.CLAUDE_CODE_USE_GEMINI,
  CLAUDE_CODE_USE_OPENAI: process.env.CLAUDE_CODE_USE_OPENAI,
  CLAUDE_CODE_USE_BEDROCK: process.env.CLAUDE_CODE_USE_BEDROCK,
  CLAUDE_CODE_USE_VERTEX: process.env.CLAUDE_CODE_USE_VERTEX,
  CLAUDE_CODE_USE_FOUNDRY: process.env.CLAUDE_CODE_USE_FOUNDRY,
}

const defaultLimits: ClaudeAILimits = {
  status: 'allowed',
  unifiedRateLimitFallbackAvailable: false,
  isUsingOverage: false,
}

function resetProviderEnv(): void {
  process.env.CLAUDE_CODE_USE_GEMINI = originalEnv.CLAUDE_CODE_USE_GEMINI
  process.env.CLAUDE_CODE_USE_OPENAI = originalEnv.CLAUDE_CODE_USE_OPENAI
  process.env.CLAUDE_CODE_USE_BEDROCK = originalEnv.CLAUDE_CODE_USE_BEDROCK
  process.env.CLAUDE_CODE_USE_VERTEX = originalEnv.CLAUDE_CODE_USE_VERTEX
  process.env.CLAUDE_CODE_USE_FOUNDRY = originalEnv.CLAUDE_CODE_USE_FOUNDRY
}

function clearProviderEnv(): void {
  delete process.env.CLAUDE_CODE_USE_GEMINI
  delete process.env.CLAUDE_CODE_USE_OPENAI
  delete process.env.CLAUDE_CODE_USE_BEDROCK
  delete process.env.CLAUDE_CODE_USE_VERTEX
  delete process.env.CLAUDE_CODE_USE_FOUNDRY
}

afterEach(() => {
  resetProviderEnv()
  emitStatusChange(defaultLimits)
})

test('third-party providers hide Claude.ai session limit warnings', () => {
  process.env.CLAUDE_CODE_USE_GEMINI = '1'

  const warning = getRateLimitWarning(
    {
      status: 'allowed_warning',
      unifiedRateLimitFallbackAvailable: false,
      isUsingOverage: false,
      rateLimitType: 'five_hour',
      utilization: 1,
      resetsAt: Math.floor(Date.now() / 1000) + 60 * 60,
    },
    'gemini-3.1-pro',
  )

  expect(warning).toBeNull()
})

test('third-party model prefixes hide Claude.ai session limit warnings in first-party runtime', () => {
  clearProviderEnv()

  const warning = getRateLimitWarning(
    {
      status: 'allowed_warning',
      unifiedRateLimitFallbackAvailable: false,
      isUsingOverage: false,
      rateLimitType: 'five_hour',
      utilization: 1,
      resetsAt: Math.floor(Date.now() / 1000) + 60 * 60,
    },
    'codex:gpt-5.4',
  )

  expect(warning).toBeNull()
})

test('third-party providers do not expose stale Claude.ai limits state', () => {
  clearProviderEnv()
  emitStatusChange({
    status: 'rejected',
    unifiedRateLimitFallbackAvailable: false,
    isUsingOverage: false,
    rateLimitType: 'five_hour',
    resetsAt: Math.floor(Date.now() / 1000) + 60 * 60,
  })

  process.env.CLAUDE_CODE_USE_GEMINI = '1'

  expect(getCurrentClaudeAiLimits()).toEqual(defaultLimits)
})

test('third-party model prefixes do not expose stale Claude.ai limits state', () => {
  clearProviderEnv()
  emitStatusChange({
    status: 'rejected',
    unifiedRateLimitFallbackAvailable: false,
    isUsingOverage: false,
    rateLimitType: 'five_hour',
    resetsAt: Math.floor(Date.now() / 1000) + 60 * 60,
  })

  expect(getCurrentClaudeAiLimits('codex:gpt-5.4')).toEqual(defaultLimits)
})

test('explicit anthropic model prefixes still expose Claude.ai limits outside first-party env', () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  emitStatusChange({
    status: 'allowed_warning',
    unifiedRateLimitFallbackAvailable: false,
    isUsingOverage: false,
    rateLimitType: 'five_hour',
    utilization: 1,
    resetsAt: Math.floor(Date.now() / 1000) + 60 * 60,
  })

  const warning = getRateLimitWarning(
    getCurrentClaudeAiLimits('anthropic:claude-sonnet-4-6'),
    'anthropic:claude-sonnet-4-6',
  )

  expect(warning).toContain('session limit')
})

test('first-party providers still expose Claude.ai session limit warnings', () => {
  clearProviderEnv()

  const warning = getRateLimitWarning(
    {
      status: 'allowed_warning',
      unifiedRateLimitFallbackAvailable: false,
      isUsingOverage: false,
      rateLimitType: 'five_hour',
      utilization: 1,
      resetsAt: Math.floor(Date.now() / 1000) + 60 * 60,
    },
    'claude-sonnet-4-6',
  )

  expect(warning).toContain('session limit')
})
