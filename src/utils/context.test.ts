import { afterEach, expect, test } from 'bun:test'

import {
  getContextWindowForModel,
  getModelMaxOutputTokens,
} from './context.js'

const originalEnv = {
  CLAUDE_CODE_USE_OPENAI: process.env.CLAUDE_CODE_USE_OPENAI,
  CLAUDE_CODE_MAX_OUTPUT_TOKENS: process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS,
}

afterEach(() => {
  process.env.CLAUDE_CODE_USE_OPENAI = originalEnv.CLAUDE_CODE_USE_OPENAI
  process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS =
    originalEnv.CLAUDE_CODE_MAX_OUTPUT_TOKENS
})

test('deepseek-chat uses provider-specific context and output caps', () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  delete process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS

  expect(getContextWindowForModel('deepseek-chat')).toBe(128_000)
  expect(getModelMaxOutputTokens('deepseek-chat')).toEqual({
    default: 8_192,
    upperLimit: 8_192,
  })
})

test('provider-prefixed OpenAI models use the OpenAI window table even without provider env flags', () => {
  delete process.env.CLAUDE_CODE_USE_OPENAI
  delete process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS

  expect(getContextWindowForModel('openai:gpt-4.1')).toBe(1_047_576)
  expect(getModelMaxOutputTokens('openai:gpt-4.1')).toEqual({
    default: 32_768,
    upperLimit: 32_768,
  })
})

test('provider-prefixed Codex models use Codex-specific context and output caps', () => {
  delete process.env.CLAUDE_CODE_USE_OPENAI
  delete process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS

  expect(getContextWindowForModel('codex:gpt-5.2-codex')).toBe(400_000)
  expect(getModelMaxOutputTokens('codex:gpt-5.2-codex')).toEqual({
    default: 128_000,
    upperLimit: 128_000,
  })

  expect(getContextWindowForModel('codex:codex-mini-latest')).toBe(200_000)
  expect(getModelMaxOutputTokens('codex:codex-mini-latest')).toEqual({
    default: 100_000,
    upperLimit: 100_000,
  })
})
