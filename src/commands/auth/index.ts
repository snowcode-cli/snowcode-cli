import type { Command } from '../../commands.js'

export default () =>
  ({
    type: 'local-jsx',
    name: 'auth',
    description: 'Sign in to a provider — claude.ai, OpenAI, Gemini, Z.AI',
    isEnabled: () => true,
    load: () => import('./auth.js'),
  }) satisfies Command
