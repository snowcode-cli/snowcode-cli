import { expect, test } from 'bun:test'

import {
  getCurrentUsage,
  tokenCountWithEstimation,
} from './tokens.js'

test('falls back to rough estimation when assistant usage is all zeros', () => {
  const messages = [
    {
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'text', text: 'isto devia contar tokens' }],
      },
    },
    {
      type: 'assistant',
      message: {
        id: 'msg_zero_usage',
        role: 'assistant',
        model: 'codex:gpt-5.4',
        content: [{ type: 'text', text: 'resposta do codex' }],
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      },
    },
  ] as any

  expect(getCurrentUsage(messages)).toBeNull()
  expect(tokenCountWithEstimation(messages)).toBeGreaterThan(0)
})

test('keeps exact usage when assistant usage is real', () => {
  const messages = [
    {
      type: 'assistant',
      message: {
        id: 'msg_real_usage',
        role: 'assistant',
        model: 'codex:gpt-5.4',
        content: [{ type: 'text', text: 'resposta curta' }],
        usage: {
          input_tokens: 120,
          output_tokens: 30,
          cache_creation_input_tokens: 10,
          cache_read_input_tokens: 5,
        },
      },
    },
  ] as any

  expect(getCurrentUsage(messages)).toEqual({
    input_tokens: 120,
    output_tokens: 30,
    cache_creation_input_tokens: 10,
    cache_read_input_tokens: 5,
  })
  expect(tokenCountWithEstimation(messages)).toBe(165)
})
