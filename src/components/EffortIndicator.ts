import {
  EFFORT_HIGH,
  EFFORT_LOW,
  EFFORT_MAX,
  EFFORT_MEDIUM,
} from '../constants/figures.js'
import type { EffortLevel, EffortValue } from '../utils/effort.js'
import { getInferenceControlState } from '../utils/reasoningControl.js'

export function getInferenceControlNotificationText(
  effortValue: EffortValue | undefined,
  thinkingEnabled: boolean | undefined,
  model: string,
): string | undefined {
  const control = getInferenceControlState(model, {
    effortValue,
    thinkingEnabled,
  })

  switch (control.kind) {
    case 'levels':
      return `${effortLevelToSymbol(control.value)} ${control.value} ${control.label} · /${control.commandName}`
    case 'toggle':
      return `thinking ${control.enabled ? 'on' : 'off'} · /thinking`
    default:
      return undefined
  }
}

export function effortLevelToSymbol(level: EffortLevel): string {
  switch (level) {
    case 'low':
      return EFFORT_LOW
    case 'medium':
      return EFFORT_MEDIUM
    case 'high':
      return EFFORT_HIGH
    case 'max':
      return EFFORT_MAX
    default:
      return EFFORT_HIGH
  }
}
