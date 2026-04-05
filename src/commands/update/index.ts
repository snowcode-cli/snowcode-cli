import type { Command } from '../../commands.js'

const update = {
  type: 'local',
  name: 'update',
  description: 'Check for snowcode updates and install the latest version',
  isEnabled: () => true,
  supportsNonInteractive: true,
  load: () => import('./update.js'),
} satisfies Command

export default update
