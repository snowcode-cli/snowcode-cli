import type { Command } from '../../commands.js'

export default {
  type: 'local-jsx',
  name: 'usage',
  description: 'Show usage across all providers',
  isEnabled: () => true,
  isHidden: false,
  load: () => import('./usage.js'),
} satisfies Command
