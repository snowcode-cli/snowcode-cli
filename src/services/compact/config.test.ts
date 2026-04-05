import assert from 'node:assert/strict'
import test from 'node:test'

import {
  resolveConfiguredAutoCompactMilestones,
  resolveConfiguredAutoCompactWindowTokens,
  resolveConfiguredCompactCooldownMinutes,
  resolveConfiguredCompactMinGainTokens,
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

test('auto-compact milestones support comma-separated strings', () => {
  const milestones = resolveConfiguredAutoCompactMilestones({
    settingsAutoCompactMilestones: '120000, 80000, 100000',
  })

  assert.deepEqual(milestones, [80000, 100000, 120000])
})

test('auto-compact milestones support arrays', () => {
  const milestones = resolveConfiguredAutoCompactMilestones({
    settingsAutoCompactMilestones: [150000, 100000],
  })

  assert.deepEqual(milestones, [100000, 150000])
})

test('auto-compact milestones reject invalid entries', () => {
  const milestones = resolveConfiguredAutoCompactMilestones({
    settingsAutoCompactMilestones: '100000, nope, 120000',
  })

  assert.equal(milestones, null)
})

test('compact min gain accepts non-negative integers', () => {
  const gain = resolveConfiguredCompactMinGainTokens({
    settingsCompactMinGainTokens: '12000',
  })

  assert.equal(gain, 12000)
})

test('compact cooldown accepts zero', () => {
  const cooldown = resolveConfiguredCompactCooldownMinutes({
    settingsCompactCooldownMinutes: 0,
  })

  assert.equal(cooldown, 0)
})
