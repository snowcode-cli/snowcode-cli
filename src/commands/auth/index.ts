import type { Command } from '../../commands.js'

export default () =>
  ({
    type: 'local-jsx',
    name: 'auth',
    aliases: ['login'],
    description: 'Sign in to a provider - Claude, Codex, Gemini, Z.AI',
    isEnabled: () => true,
    load: () => import('./auth.js'),
  }) satisfies Command
