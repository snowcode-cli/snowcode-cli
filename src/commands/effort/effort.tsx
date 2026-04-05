import * as React from 'react'
import { useMainLoopModel } from '../../hooks/useMainLoopModel.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js'
import { useAppState, useSetAppState } from '../../state/AppState.js'
import type { LocalJSXCommandOnDone } from '../../types/command.js'
import {
  type EffortValue,
  getDisplayedEffortLevel,
  getEffortEnvOverride,
  getEffortValueDescription,
  isEffortLevel,
  toPersistableEffort,
} from '../../utils/effort.js'
import {
  getInferenceControlDescriptor,
  getInferenceControlState,
} from '../../utils/reasoningControl.js'
import {
  getSettingsForSource,
  updateSettingsForSource,
} from '../../utils/settings/settings.js'
import { shouldEnableThinkingByDefault } from '../../utils/thinking.js'

const COMMON_HELP_ARGS = ['help', '-h', '--help']
const THINKING_ENABLE_ARGS = new Set(['on', 'true', 'enable', 'enabled'])
const THINKING_DISABLE_ARGS = new Set(['off', 'false', 'disable', 'disabled'])

type InferenceCommandResult = {
  message: string
  effortUpdate?: {
    value: EffortValue | undefined
  }
  thinkingUpdate?: {
    value: boolean
  }
}

function capitalizeLabel(label: string): string {
  return label.charAt(0).toUpperCase() + label.slice(1)
}

function setEffortValue(
  effortValue: EffortValue,
  model: string,
): InferenceCommandResult {
  const persistable = toPersistableEffort(effortValue)
  if (persistable !== undefined) {
    const result = updateSettingsForSource('userSettings', {
      effortLevel: persistable,
    })
    if (result.error) {
      return {
        message: `Failed to set effort level: ${result.error.message}`,
      }
    }
  }

  logEvent('tengu_effort_command', {
    effort:
      effortValue as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })

  const descriptor = getInferenceControlDescriptor(model)
  const label = descriptor.kind === 'levels' ? descriptor.label : 'effort'
  const envOverride = getEffortEnvOverride()

  if (envOverride !== undefined && envOverride !== effortValue) {
    const envRaw = process.env.CLAUDE_CODE_EFFORT_LEVEL
    if (persistable === undefined) {
      return {
        message: `Not applied: CLAUDE_CODE_EFFORT_LEVEL=${envRaw} overrides ${label} this session, and ${effortValue} is session-only (nothing saved)`,
        effortUpdate: {
          value: effortValue,
        },
      }
    }
    return {
      message: `CLAUDE_CODE_EFFORT_LEVEL=${envRaw} overrides this session; clear it and ${effortValue} ${label} takes over`,
      effortUpdate: {
        value: effortValue,
      },
    }
  }

  return {
    message: `Set ${label} to ${effortValue}${persistable !== undefined ? '' : ' (this session only)'}: ${getEffortValueDescription(effortValue)}`,
    effortUpdate: {
      value: effortValue,
    },
  }
}

function setThinkingValue(enabled: boolean): InferenceCommandResult {
  const result = updateSettingsForSource('userSettings', {
    alwaysThinkingEnabled: enabled,
  })
  if (result.error) {
    return {
      message: `Failed to set thinking mode: ${result.error.message}`,
    }
  }

  logEvent('tengu_effort_command', {
    effort:
      `thinking:${enabled ? 'on' : 'off'}` as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })

  return {
    message: `Set thinking to ${enabled ? 'on' : 'off'}: Claude will ${
      enabled
        ? 'think before responding'
        : 'respond without extended thinking'
    }`,
    thinkingUpdate: {
      value: enabled,
    },
  }
}

export function showCurrentEffort(
  appStateEffort: EffortValue | undefined,
  model: string,
  thinkingEnabled: boolean | undefined,
  options?: { defaultThinkingEnabled?: boolean },
): InferenceCommandResult {
  const descriptor = getInferenceControlDescriptor(model)
  const defaultThinkingEnabled =
    options?.defaultThinkingEnabled ?? shouldEnableThinkingByDefault()

  switch (descriptor.kind) {
    case 'levels': {
      const envOverride = getEffortEnvOverride()
      const effectiveValue =
        envOverride === null ? undefined : (envOverride ?? appStateEffort)

      if (effectiveValue === undefined) {
        return {
          message: `${capitalizeLabel(descriptor.label)}: auto (currently ${getDisplayedEffortLevel(
            model,
            appStateEffort,
          )})`,
        }
      }

      return {
        message: `Current ${descriptor.label}: ${effectiveValue} (${getEffortValueDescription(
          effectiveValue,
        )})`,
      }
    }
    case 'toggle': {
      const current = getInferenceControlState(
        model,
        {
          effortValue: appStateEffort,
          thinkingEnabled,
        },
        { defaultThinkingEnabled },
      )
      if (current.kind !== 'toggle') {
        return {
          message: 'Thinking is not available for this model.',
        }
      }

      if (getSettingsForSource('userSettings')?.alwaysThinkingEnabled === undefined) {
        return {
          message: `Thinking: auto (currently ${current.enabled ? 'on' : 'off'})`,
        }
      }

      return {
        message: `Current thinking: ${current.enabled ? 'on' : 'off'}`,
      }
    }
    default:
      return {
        message:
          'This model does not expose configurable reasoning, effort, or thinking controls.',
      }
  }
}

function unsetInferenceControl(
  model: string,
  defaultThinkingEnabled: boolean,
): InferenceCommandResult {
  const descriptor = getInferenceControlDescriptor(model)

  if (descriptor.kind === 'none') {
    return {
      message:
        'This model does not expose configurable reasoning, effort, or thinking controls.',
    }
  }

  if (descriptor.kind === 'toggle') {
    const result = updateSettingsForSource('userSettings', {
      alwaysThinkingEnabled: undefined,
    })
    if (result.error) {
      return {
        message: `Failed to set thinking mode: ${result.error.message}`,
      }
    }

    logEvent('tengu_effort_command', {
      effort:
        'thinking:auto' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })

    return {
      message: `Thinking set to auto (currently ${defaultThinkingEnabled ? 'on' : 'off'})`,
      thinkingUpdate: {
        value: defaultThinkingEnabled,
      },
    }
  }

  const result = updateSettingsForSource('userSettings', {
    effortLevel: undefined,
  })
  if (result.error) {
    return {
      message: `Failed to set effort level: ${result.error.message}`,
    }
  }

  logEvent('tengu_effort_command', {
    effort: 'auto' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })

  const envOverride = getEffortEnvOverride()
  if (envOverride !== undefined && envOverride !== null) {
    const envRaw = process.env.CLAUDE_CODE_EFFORT_LEVEL
    return {
      message: `Cleared ${descriptor.label} from settings, but CLAUDE_CODE_EFFORT_LEVEL=${envRaw} still controls this session`,
      effortUpdate: {
        value: undefined,
      },
    }
  }

  return {
    message: `${capitalizeLabel(descriptor.label)} set to auto`,
    effortUpdate: {
      value: undefined,
    },
  }
}

export function executeEffort(
  args: string,
  model: string,
  thinkingEnabled: boolean | undefined,
  options?: { defaultThinkingEnabled?: boolean },
): InferenceCommandResult {
  const normalized = args.trim().toLowerCase()
  const defaultThinkingEnabled =
    options?.defaultThinkingEnabled ?? shouldEnableThinkingByDefault()
  const descriptor = getInferenceControlDescriptor(model)

  if (normalized === 'auto' || normalized === 'unset') {
    return unsetInferenceControl(model, defaultThinkingEnabled)
  }

  if (descriptor.kind === 'levels') {
    if (!isEffortLevel(normalized) || !descriptor.levels.includes(normalized)) {
      return {
        message: `Invalid argument: ${args}. Valid options are: ${descriptor.levels.join(', ')}, auto`,
      }
    }
    return setEffortValue(normalized, model)
  }

  if (descriptor.kind === 'toggle') {
    if (THINKING_ENABLE_ARGS.has(normalized)) {
      return setThinkingValue(true)
    }
    if (THINKING_DISABLE_ARGS.has(normalized)) {
      return setThinkingValue(false)
    }
    return {
      message: `Invalid argument: ${args}. Valid options are: on, off, auto`,
    }
  }

  return {
    message:
      'This model does not expose configurable reasoning, effort, or thinking controls.',
  }
}

function ShowCurrentInference({
  onDone,
}: {
  onDone: (result: string) => void
}): React.ReactNode {
  const effortValue = useAppState(s => s.effortValue)
  const thinkingEnabled = useAppState(s => s.thinkingEnabled)
  const model = useMainLoopModel()

  const { message } = showCurrentEffort(effortValue, model, thinkingEnabled, {
    defaultThinkingEnabled: shouldEnableThinkingByDefault(),
  })

  React.useEffect(() => {
    onDone(message)
  }, [message, onDone])

  return null
}

function RunInferenceCommand({
  args,
  onDone,
}: {
  args: string
  onDone: (result: string) => void
}): React.ReactNode {
  const model = useMainLoopModel()
  const thinkingEnabled = useAppState(s => s.thinkingEnabled)
  const setAppState = useSetAppState()
  const hasRunRef = React.useRef(false)

  React.useEffect(() => {
    if (hasRunRef.current) {
      return
    }
    hasRunRef.current = true

    const result = executeEffort(args, model, thinkingEnabled, {
      defaultThinkingEnabled: shouldEnableThinkingByDefault(),
    })

    setAppState(prev => ({
      ...prev,
      ...(result.effortUpdate
        ? { effortValue: result.effortUpdate.value }
        : {}),
      ...(result.thinkingUpdate
        ? { thinkingEnabled: result.thinkingUpdate.value }
        : {}),
    }))

    onDone(result.message)
  }, [args, model, onDone, setAppState, thinkingEnabled])

  return null
}

export async function call(
  onDone: LocalJSXCommandOnDone,
  _context: unknown,
  args?: string,
): Promise<React.ReactNode> {
  const trimmedArgs = args?.trim() || ''

  if (COMMON_HELP_ARGS.includes(trimmedArgs)) {
    onDone(
      'Usage: /effort [value]\nAliases: /reasoning, /thinking\n\nValues depend on the current model:\n- reasoning/effort models: low, medium, high, max, auto\n- thinking models: on, off, auto',
    )
    return
  }

  if (!trimmedArgs || trimmedArgs === 'current' || trimmedArgs === 'status') {
    return <ShowCurrentInference onDone={onDone} />
  }

  return <RunInferenceCommand args={trimmedArgs} onDone={onDone} />
}
