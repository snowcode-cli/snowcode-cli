import { expect, test } from 'bun:test'

import {
  formatInferenceControlSelection,
  getInferenceControlDescriptor,
  getInferenceControlState,
  getInferenceControlStatusNote,
} from './reasoningControl.js'
import { modelSupportsThinking } from './thinking.js'

test('OpenAI reasoning models expose reasoning levels', () => {
  expect(getInferenceControlDescriptor('openai:gpt-5.4')).toEqual({
    kind: 'levels',
    label: 'reasoning',
    commandName: 'reasoning',
    levels: ['low', 'medium', 'high'],
    defaultValue: 'high',
  })
})

test('Anthropic Claude 4.6 exposes effort levels', () => {
  expect(getInferenceControlDescriptor('anthropic:claude-sonnet-4-6')).toEqual({
    kind: 'levels',
    label: 'effort',
    commandName: 'effort',
    levels: ['low', 'medium', 'high'],
    defaultValue: 'high',
  })
})

test('Anthropic haiku exposes thinking toggle when effort is unavailable', () => {
  expect(getInferenceControlDescriptor('anthropic:claude-haiku-4-5')).toEqual({
    kind: 'toggle',
    label: 'thinking',
    commandName: 'thinking',
  })
})

test('Gemini models expose no inference controls', () => {
  expect(getInferenceControlDescriptor('antigravity:gemini-3.1-pro')).toEqual({
    kind: 'none',
    label: 'inference',
    commandName: 'effort',
  })
})

test('thinking status note is shown when user overrides the default', () => {
  expect(
    getInferenceControlStatusNote(
      'anthropic:claude-haiku-4-5',
      {
        effortValue: undefined,
        thinkingEnabled: false,
      },
      { defaultThinkingEnabled: true },
    ),
  ).toBe(' (thinking: off)')
})

test('formatted selection uses the provider-specific control name', () => {
  expect(
    formatInferenceControlSelection(
      getInferenceControlState(
        'openai:gpt-5.4',
        {
          effortValue: 'medium',
          thinkingEnabled: undefined,
        },
        { defaultThinkingEnabled: true },
      ),
    ),
  ).toBe('medium reasoning')
})

test('OpenAI and Gemini models do not claim Claude thinking support', () => {
  expect(modelSupportsThinking('openai:gpt-5.4')).toBe(false)
  expect(modelSupportsThinking('antigravity:gemini-3.1-pro')).toBe(false)
})
