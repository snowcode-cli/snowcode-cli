import type { Command } from '../../commands.js'
import { shouldInferenceConfigCommandBeImmediate } from '../../utils/immediateCommand.js'

export default {
  type: 'local-jsx',
  name: 'effort',
  aliases: ['reasoning', 'thinking'],
  description: 'Set reasoning, effort, or thinking for the current model',
  argumentHint: '[low|medium|high|max|on|off|auto]',
  get immediate() {
    return shouldInferenceConfigCommandBeImmediate()
  },
  load: () => import('./effort.js'),
} satisfies Command
