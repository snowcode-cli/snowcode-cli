import { expect, test } from 'bun:test'

import { DEFAULT_MODELS } from './modelConfig.js'

test('default model config includes the public Codex model slugs', () => {
  const expectedModels = [
    'codex:gpt-5.2-codex',
    'codex:gpt-5.1-codex-max',
    'codex:gpt-5.1-codex',
    'codex:gpt-5.1-codex-mini',
    'codex:gpt-5-codex',
    'codex:codex-mini-latest',
    'codex:gpt-5.4',
    'codex:gpt-5.3-codex-spark',
    'codex:codex-plan',
    'codex:codex-spark',
  ]

  for (const model of expectedModels) {
    expect(DEFAULT_MODELS).toContain(model)
  }
})
