import type { Command } from '../../commands.js'

export default {
  type: 'local-jsx',
  name: 'fallback',
  description: 'Configure provider fallback order when rate-limited',
  isEnabled: () => true,
  isHidden: false,
  load: () => import('./fallback.js'),
} satisfies Command
