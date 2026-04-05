import { expect, test } from 'bun:test'

import { modelSupportsEffort } from './effort.js'

test('provider-prefixed OpenAI reasoning models expose effort support', () => {
  expect(modelSupportsEffort('openai:gpt-5.4')).toBe(true)
  expect(modelSupportsEffort('codex:codex-plan')).toBe(true)
})

test('non-reasoning OpenAI models do not claim effort support by default', () => {
  expect(modelSupportsEffort('openai:gpt-4.1-mini')).toBe(false)
})
