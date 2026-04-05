import { expect, test } from 'bun:test'

import {
  getCanonicalName,
  parseUserSpecifiedModel,
  renderModelName,
} from './model.js'

test('anthropic-prefixed models resolve back to the native Anthropic id', () => {
  expect(parseUserSpecifiedModel('anthropic:claude-sonnet-4-6')).toBe(
    'claude-sonnet-4-6',
  )
})

test('canonical name strips provider prefixes before family matching', () => {
  expect(getCanonicalName('anthropic:claude-opus-4-6')).toBe('claude-opus-4-6')
})

test('rendered model names keep explicit provider context', () => {
  expect(renderModelName('openai:gpt-5.4')).toBe('OpenAI:GPT-5.4')
  expect(renderModelName('codex:gpt-5.2-codex')).toBe('Codex:GPT-5.2 Codex')
})
