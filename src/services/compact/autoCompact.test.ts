import assert from 'node:assert/strict'
import test from 'node:test'

import { getAutoCompactPolicyDecision } from './autoCompact.js'

test('auto-compact policy stays idle below threshold and milestones', () => {
  const decision = getAutoCompactPolicyDecision({
    tokenUsage: 50_000,
    autoCompactThreshold: 120_000,
  })

  assert.equal(decision.shouldCompact, false)
  assert.equal(decision.reason, 'below-threshold')
})

test('auto-compact policy triggers on configured milestone', () => {
  const decision = getAutoCompactPolicyDecision({
    tokenUsage: 101_000,
    autoCompactThreshold: 140_000,
    milestones: [80_000, 100_000, 120_000],
  })

  assert.equal(decision.shouldCompact, true)
  assert.equal(decision.reason, 'milestone')
  assert.equal(decision.matchedMilestone, 100_000)
})

test('auto-compact policy respects cooldown after a compact', () => {
  const decision = getAutoCompactPolicyDecision({
    tokenUsage: 140_000,
    autoCompactThreshold: 120_000,
    cooldownMinutes: 10,
    state: {
      lastCompactAt: '2026-04-05T10:00:00.000Z',
    },
    nowMs: Date.parse('2026-04-05T10:05:00.000Z'),
  })

  assert.equal(decision.shouldCompact, false)
  assert.equal(decision.reason, 'cooldown')
})

test('auto-compact policy delays retry after a low-value compact', () => {
  const decision = getAutoCompactPolicyDecision({
    tokenUsage: 105_000,
    autoCompactThreshold: 100_000,
    minGainTokens: 12_000,
    state: {
      lastCompactInputTokens: 100_000,
      lastCompactSavedTokens: 4_000,
    },
  })

  assert.equal(decision.shouldCompact, false)
  assert.equal(decision.reason, 'min-gain')
})

test('auto-compact policy allows retry once enough new context accumulated', () => {
  const decision = getAutoCompactPolicyDecision({
    tokenUsage: 113_000,
    autoCompactThreshold: 100_000,
    minGainTokens: 12_000,
    state: {
      lastCompactInputTokens: 100_000,
      lastCompactSavedTokens: 4_000,
    },
  })

  assert.equal(decision.shouldCompact, true)
  assert.equal(decision.reason, 'threshold')
})
