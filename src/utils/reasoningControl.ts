import memoize from 'lodash-es/memoize.js'
import {
  convertEffortValueToLevel,
  getDefaultEffortForModel,
  getDisplayedEffortLevel,
  getEffortControlLabel,
  modelSupportsEffort,
  modelSupportsMaxEffort,
  type EffortLevel,
  type EffortValue,
} from './effort.js'
import { modelSupportsThinking, shouldEnableThinkingByDefault } from './thinking.js'

export type InferenceControlDescriptor =
  | {
      kind: 'none'
      label: 'inference'
      commandName: 'effort'
    }
  | {
      kind: 'levels'
      label: 'effort' | 'reasoning'
      commandName: 'effort' | 'reasoning'
      levels: readonly EffortLevel[]
      defaultValue: EffortLevel
    }
  | {
      kind: 'toggle'
      label: 'thinking'
      commandName: 'thinking'
    }

export type InferenceControlStateInput = {
  effortValue: EffortValue | undefined
  thinkingEnabled: boolean | undefined
}

export type InferenceControlState =
  | {
      kind: 'none'
      label: 'inference'
      commandName: 'effort'
    }
  | {
      kind: 'levels'
      label: 'effort' | 'reasoning'
      commandName: 'effort' | 'reasoning'
      levels: readonly EffortLevel[]
      defaultValue: EffortLevel
      value: EffortLevel
    }
  | {
      kind: 'toggle'
      label: 'thinking'
      commandName: 'thinking'
      enabled: boolean
      defaultValue: boolean
    }

function getDefaultEffortLevel(model: string): EffortLevel {
  const defaultValue = getDefaultEffortForModel(model)
  return defaultValue !== undefined ? convertEffortValueToLevel(defaultValue) : 'high'
}

const getInferenceControlDescriptorUncached = (
  model: string,
): InferenceControlDescriptor => {
  if (modelSupportsEffort(model)) {
    const label = getEffortControlLabel(model)
    return {
      kind: 'levels',
      label,
      commandName: label,
      levels: modelSupportsMaxEffort(model)
        ? ['low', 'medium', 'high', 'max']
        : ['low', 'medium', 'high'],
      defaultValue: getDefaultEffortLevel(model),
    }
  }

  if (modelSupportsThinking(model)) {
    return {
      kind: 'toggle',
      label: 'thinking',
      commandName: 'thinking',
    }
  }

  return {
    kind: 'none',
    label: 'inference',
    commandName: 'effort',
  }
}

export const getInferenceControlDescriptor = memoize(
  getInferenceControlDescriptorUncached,
  model => model,
)

export function getInferenceControlState(
  model: string,
  input: InferenceControlStateInput,
  options?: { defaultThinkingEnabled?: boolean },
): InferenceControlState {
  const descriptor = getInferenceControlDescriptor(model)

  switch (descriptor.kind) {
    case 'levels':
      return {
        ...descriptor,
        value: getDisplayedEffortLevel(model, input.effortValue),
      }
    case 'toggle': {
      const defaultThinkingEnabled =
        options?.defaultThinkingEnabled ?? shouldEnableThinkingByDefault()
      return {
        ...descriptor,
        enabled: input.thinkingEnabled ?? defaultThinkingEnabled,
        defaultValue: defaultThinkingEnabled,
      }
    }
    default:
      return descriptor
  }
}

export function formatInferenceControlSelection(
  control: InferenceControlState,
): string | undefined {
  switch (control.kind) {
    case 'levels':
      return `${control.value} ${control.label}`
    case 'toggle':
      return `thinking ${control.enabled ? 'on' : 'off'}`
    default:
      return undefined
  }
}

export function getInferenceControlStatusNote(
  model: string,
  input: InferenceControlStateInput,
  options?: { defaultThinkingEnabled?: boolean },
): string {
  const control = getInferenceControlState(model, input, options)

  switch (control.kind) {
    case 'levels':
      return input.effortValue !== undefined
        ? ` (${control.label}: ${control.value})`
        : ''
    case 'toggle':
      return control.enabled !== control.defaultValue
        ? ` (thinking: ${control.enabled ? 'on' : 'off'})`
        : ''
    default:
      return ''
  }
}

export function resolvePickerThinkingPersistence(
  picked: boolean,
  defaultValue: boolean,
  priorPersisted: boolean | undefined,
  toggledInPicker: boolean,
): boolean | undefined {
  const hadExplicit = priorPersisted !== undefined || toggledInPicker
  return hadExplicit || picked !== defaultValue ? picked : undefined
}
