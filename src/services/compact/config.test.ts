import assert from 'node:assert/strict'
import test from 'node:test'

import {
  resolveConfiguredAutoCompactWindowTokens,
  resolveConfiguredCompactModel,
} from './config.js'

test('compact model uses env override first', () => {
  const model = resolveConfiguredCompactModel('gpt-4o', {
    envCompactModel: 'gpt-4o-mini',
    settingsCompactModel: 'gpt-4.1-mini',
  })

  assert.equal(model, 'gpt-4o-mini')
})

test('compact model falls back to settings when env is absent', () => {
  const model = resolveConfiguredCompactModel('gpt-4o', {
    settingsCompactModel: 'gpt-4.1-mini',
  })

  assert.equal(model, 'gpt-4.1-mini')
})

test('compact model falls back to main loop model when overrides are empty', () => {
  const model = resolveConfiguredCompactModel('gpt-4o', {
    envCompactModel: '   ',
    settingsCompactModel: '',
  })

  assert.equal(model, 'gpt-4o')
})

test('auto-compact window uses env override first', () => {
  const windowTokens = resolveConfiguredAutoCompactWindowTokens({
    envAutoCompactWindow: '90000',
    settingsAutoCompactWindow: 120000,
  })

  assert.equal(windowTokens, 90000)
})

test('auto-compact window falls back to settings when env is missing', () => {
  const windowTokens = resolveConfiguredAutoCompactWindowTokens({
    settingsAutoCompactWindow: 120000,
  })

  assert.equal(windowTokens, 120000)
})

test('auto-compact window ignores invalid values', () => {
  const windowTokens = resolveConfiguredAutoCompactWindowTokens({
    envAutoCompactWindow: '12k',
    settingsAutoCompactWindow: 0,
  })

  assert.equal(windowTokens, null)
})
