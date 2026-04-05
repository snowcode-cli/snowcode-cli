import capitalize from 'lodash-es/capitalize.js'
import * as React from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useExitOnCtrlCDWithKeybindings } from 'src/hooks/useExitOnCtrlCDWithKeybindings.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import {
  FAST_MODE_MODEL_DISPLAY,
  isFastModeAvailable,
  isFastModeCooldown,
  isFastModeEnabled,
} from 'src/utils/fastMode.js'
import { Box, Text } from '../ink.js'
import { useKeybindings } from '../keybindings/useKeybinding.js'
import { useAppState, useSetAppState } from '../state/AppState.js'
import {
  convertEffortValueToLevel,
  type EffortLevel,
  resolvePickerEffortPersistence,
  toPersistableEffort,
} from '../utils/effort.js'
import {
  getDefaultMainLoopModel,
  type ModelSetting,
  modelDisplayString,
  parseUserSpecifiedModel,
} from '../utils/model/model.js'
import { getModelOptions } from '../utils/model/modelOptions.js'
import {
  formatInferenceControlSelection,
  getInferenceControlDescriptor,
  getInferenceControlState,
  resolvePickerThinkingPersistence,
} from '../utils/reasoningControl.js'
import { getSettingsForSource, updateSettingsForSource } from '../utils/settings/settings.js'
import { shouldEnableThinkingByDefault } from '../utils/thinking.js'
import { ConfigurableShortcutHint } from './ConfigurableShortcutHint.js'
import { Select } from './CustomSelect/index.js'
import { Byline } from './design-system/Byline.js'
import { KeyboardShortcutHint } from './design-system/KeyboardShortcutHint.js'
import { Pane } from './design-system/Pane.js'
import { effortLevelToSymbol } from './EffortIndicator.js'

export type Props = {
  initial: string | null
  sessionModel?: ModelSetting
  onSelect: (model: string | null, controlSummary: string | undefined) => void
  onCancel?: () => void
  isStandaloneCommand?: boolean
  showFastModeNotice?: boolean
  /** Overrides the dim header line below "Select model". */
  headerText?: string
  /**
   * When true, skip writing inference control settings to userSettings on
   * selection. Used by the assistant installer wizard where the model choice
   * is project-scoped and should not leak to global settings.
   */
  skipSettingsWrite?: boolean
}

const NO_PREFERENCE = '__NO_PREFERENCE__'

export function ModelPicker({
  initial,
  sessionModel,
  onSelect,
  onCancel,
  isStandaloneCommand,
  showFastModeNotice,
  headerText,
  skipSettingsWrite,
}: Props): React.ReactNode {
  const setAppState = useSetAppState()
  const exitState = useExitOnCtrlCDWithKeybindings()
  const initialValue = initial === null ? NO_PREFERENCE : initial
  const [focusedValue, setFocusedValue] = useState<string | undefined>(initialValue)
  const isFastMode = useAppState(s =>
    isFastModeEnabled() ? s.fastMode : false,
  )
  const effortValue = useAppState(s => s.effortValue)
  const thinkingEnabled = useAppState(s => s.thinkingEnabled)
  const [hasAdjustedEffort, setHasAdjustedEffort] = useState(false)
  const [hasAdjustedThinking, setHasAdjustedThinking] = useState(false)
  const [effort, setEffort] = useState<EffortLevel | undefined>(
    effortValue !== undefined ? convertEffortValueToLevel(effortValue) : undefined,
  )
  const defaultThinkingEnabled = shouldEnableThinkingByDefault()
  const [thinking, setThinking] = useState<boolean>(
    thinkingEnabled ?? defaultThinkingEnabled,
  )

  const modelOptions = useMemo(
    () => getModelOptions(isFastMode ?? false),
    [isFastMode],
  )

  const optionsWithInitial = useMemo(() => {
    if (initial !== null && !modelOptions.some(opt => opt.value === initial)) {
      return [
        ...modelOptions,
        {
          value: initial,
          label: modelDisplayString(initial),
          description: 'Current model',
        },
      ]
    }
    return modelOptions
  }, [initial, modelOptions])

  const selectOptions = useMemo(
    () =>
      optionsWithInitial.map(opt => ({
        ...opt,
        value: opt.value === null ? NO_PREFERENCE : opt.value,
      })),
    [optionsWithInitial],
  )

  const initialFocusValue = useMemo(
    () =>
      selectOptions.some(opt => opt.value === initialValue)
        ? initialValue
        : (selectOptions[0]?.value ?? undefined),
    [initialValue, selectOptions],
  )

  const visibleCount = Math.min(10, selectOptions.length)
  const hiddenCount = Math.max(0, selectOptions.length - visibleCount)
  const focusedModelName = selectOptions.find(
    opt => opt.value === focusedValue,
  )?.label
  const focusedModel = resolveOptionModel(focusedValue)
  const focusedControl = focusedModel
    ? getInferenceControlState(
        focusedModel,
        {
          effortValue: hasAdjustedEffort ? effort : effortValue,
          thinkingEnabled: hasAdjustedThinking ? thinking : thinkingEnabled,
        },
        { defaultThinkingEnabled },
      )
    : undefined

  const handleFocus = useCallback(
    (value: string) => {
      setFocusedValue(value)
      const focusedModel = resolveOptionModel(value)
      if (!focusedModel) return

      const descriptor = getInferenceControlDescriptor(focusedModel)
      if (
        descriptor.kind === 'levels' &&
        !hasAdjustedEffort &&
        effortValue === undefined
      ) {
        setEffort(descriptor.defaultValue)
      }
      if (descriptor.kind === 'toggle' && !hasAdjustedThinking) {
        setThinking(thinkingEnabled ?? defaultThinkingEnabled)
      }
    },
    [
      defaultThinkingEnabled,
      effortValue,
      hasAdjustedEffort,
      hasAdjustedThinking,
      thinkingEnabled,
    ],
  )

  const handleCycleControl = useCallback(
    (direction: 'left' | 'right') => {
      if (!focusedModel) return

      const descriptor = getInferenceControlDescriptor(focusedModel)
      if (descriptor.kind === 'levels') {
        setEffort(prev =>
          cycleEffortLevel(
            prev ?? descriptor.defaultValue,
            direction,
            descriptor.levels.includes('max'),
          ),
        )
        setHasAdjustedEffort(true)
        return
      }

      if (descriptor.kind === 'toggle') {
        setThinking(prev => !(prev ?? defaultThinkingEnabled))
        setHasAdjustedThinking(true)
      }
    },
    [defaultThinkingEnabled, focusedModel],
  )

  useKeybindings(
    {
      'modelPicker:decreaseEffort': () => handleCycleControl('left'),
      'modelPicker:increaseEffort': () => handleCycleControl('right'),
    },
    { context: 'ModelPicker' },
  )

  const handleSelect = useCallback(
    (value: string) => {
      const selectedModel = resolveOptionModel(value)
      const descriptor = getInferenceControlDescriptor(
        selectedModel ?? getDefaultMainLoopModel(),
      )

      if (descriptor.kind === 'levels') {
        logEvent('tengu_model_command_menu_effort', {
          effort:
            (hasAdjustedEffort ? effort : descriptor.defaultValue) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        })
      } else if (descriptor.kind === 'toggle') {
        logEvent('tengu_model_command_menu_effort', {
          effort:
            `thinking:${(hasAdjustedThinking ? thinking : thinkingEnabled ?? defaultThinkingEnabled) ? 'on' : 'off'}` as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        })
      }

      let controlSummary: string | undefined

      if (!skipSettingsWrite) {
        if (descriptor.kind === 'levels') {
          const pickedEffort =
            hasAdjustedEffort
              ? effort
              : effortValue !== undefined
                ? convertEffortValueToLevel(effortValue)
                : undefined
          const nextEffort = resolvePickerEffortPersistence(
            pickedEffort,
            descriptor.defaultValue,
            getSettingsForSource('userSettings')?.effortLevel,
            hasAdjustedEffort,
          )
          const persistable = toPersistableEffort(nextEffort)
          if (persistable !== undefined) {
            updateSettingsForSource('userSettings', {
              effortLevel: persistable,
            })
          }
          setAppState(prev => ({
            ...prev,
            effortValue: nextEffort,
          }))
          if (hasAdjustedEffort) {
            controlSummary = formatInferenceControlSelection(
              getInferenceControlState(
                selectedModel ?? getDefaultMainLoopModel(),
                {
                  effortValue: nextEffort,
                  thinkingEnabled,
                },
                { defaultThinkingEnabled },
              ),
            )
          }
        } else if (descriptor.kind === 'toggle') {
          const pickedThinking =
            hasAdjustedThinking ? thinking : (thinkingEnabled ?? defaultThinkingEnabled)
          const nextThinking = resolvePickerThinkingPersistence(
            pickedThinking,
            defaultThinkingEnabled,
            getSettingsForSource('userSettings')?.alwaysThinkingEnabled,
            hasAdjustedThinking,
          )
          updateSettingsForSource('userSettings', {
            alwaysThinkingEnabled: nextThinking,
          })
          setAppState(prev => ({
            ...prev,
            thinkingEnabled: nextThinking ?? pickedThinking,
          }))
          if (hasAdjustedThinking) {
            controlSummary = formatInferenceControlSelection(
              getInferenceControlState(
                selectedModel ?? getDefaultMainLoopModel(),
                {
                  effortValue,
                  thinkingEnabled: nextThinking ?? pickedThinking,
                },
                { defaultThinkingEnabled },
              ),
            )
          }
        }
      }

      if (value === NO_PREFERENCE) {
        onSelect(null, controlSummary)
        return
      }
      onSelect(value, controlSummary)
    },
    [
      defaultThinkingEnabled,
      effort,
      effortValue,
      hasAdjustedEffort,
      hasAdjustedThinking,
      onSelect,
      setAppState,
      skipSettingsWrite,
      thinking,
      thinkingEnabled,
    ],
  )

  const content = (
    <Box flexDirection="column">
      <Box marginBottom={1} flexDirection="column">
        <Text color="remember" bold>
          Select model
        </Text>
        <Text dimColor>
          {headerText ??
            'Switch between Claude models. Applies to this session and future Claude Code sessions. For other/previous model names, specify with --model.'}
        </Text>
        {sessionModel && (
          <Text dimColor>
            Currently using {modelDisplayString(sessionModel)} for this session
            {' '} (set by plan mode). Selecting a model will undo this.
          </Text>
        )}
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Box flexDirection="column">
          <Select
            defaultValue={initialValue}
            defaultFocusValue={initialFocusValue}
            options={selectOptions}
            onChange={handleSelect}
            onFocus={handleFocus}
            onCancel={onCancel ?? noop}
            visibleOptionCount={visibleCount}
          />
        </Box>
        {hiddenCount > 0 && (
          <Box paddingLeft={3}>
            <Text dimColor>and {hiddenCount} more...</Text>
          </Box>
        )}
      </Box>

      <Box marginBottom={1} flexDirection="column">
        {focusedControl?.kind === 'levels' ? (
          <Text dimColor>
            <EffortLevelIndicator effort={focusedControl.value} />{' '}
            {capitalize(focusedControl.value)} {focusedControl.label}
            {focusedControl.value === focusedControl.defaultValue ? ' (default)' : ''}
            {' '}
            <Text color="subtle">{'<- ->'} to adjust</Text>
          </Text>
        ) : focusedControl?.kind === 'toggle' ? (
          <Text dimColor>
            <ToggleIndicator enabled={focusedControl.enabled} />{' '}
            {capitalize(focusedControl.label)} {focusedControl.enabled ? 'on' : 'off'}
            {focusedControl.enabled === focusedControl.defaultValue ? ' (default)' : ''}
            {' '}
            <Text color="subtle">{'<- ->'} to adjust</Text>
          </Text>
        ) : (
          <Text color="subtle">
            Inference controls not available
            {focusedModelName ? ` for ${focusedModelName}` : ''}
          </Text>
        )}
      </Box>

      {isFastModeEnabled() &&
        (showFastModeNotice ? (
          <Box marginBottom={1}>
            <Text dimColor>
              Fast mode is <Text bold>ON</Text> and available with{' '}
              {FAST_MODE_MODEL_DISPLAY} only (/fast). Switching to other models
              turn off fast mode.
            </Text>
          </Box>
        ) : isFastModeAvailable() && !isFastModeCooldown() ? (
          <Box marginBottom={1}>
            <Text dimColor>
              Use <Text bold>/fast</Text> to turn on Fast mode ({FAST_MODE_MODEL_DISPLAY} only).
            </Text>
          </Box>
        ) : null)}

      {isStandaloneCommand && (
        <Text dimColor italic>
          {exitState.pending ? (
            <>Press {exitState.keyName} again to exit</>
          ) : (
            <Byline>
              <KeyboardShortcutHint shortcut="Enter" action="confirm" />
              <ConfigurableShortcutHint
                action="select:cancel"
                context="Select"
                fallback="Esc"
                description="exit"
              />
            </Byline>
          )}
        </Text>
      )}
    </Box>
  )

  if (!isStandaloneCommand) {
    return content
  }

  return <Pane color="permission">{content}</Pane>
}

function noop(): void {}

function resolveOptionModel(value?: string): string | undefined {
  if (!value) return undefined
  return value === NO_PREFERENCE ? getDefaultMainLoopModel() : parseUserSpecifiedModel(value)
}

function cycleEffortLevel(
  current: EffortLevel,
  direction: 'left' | 'right',
  includeMax: boolean,
): EffortLevel {
  const levels: EffortLevel[] = includeMax
    ? ['low', 'medium', 'high', 'max']
    : ['low', 'medium', 'high']
  const idx = levels.indexOf(current)
  const currentIndex = idx !== -1 ? idx : levels.indexOf('high')

  if (direction === 'right') {
    return levels[(currentIndex + 1) % levels.length]!
  }

  return levels[(currentIndex - 1 + levels.length) % levels.length]!
}

function EffortLevelIndicator({
  effort,
}: {
  effort: EffortLevel | undefined
}): React.ReactNode {
  return (
    <Text color={effort ? 'claude' : 'subtle'}>
      {effortLevelToSymbol(effort ?? 'low')}
    </Text>
  )
}

function ToggleIndicator({
  enabled,
}: {
  enabled: boolean
}): React.ReactNode {
  return <Text color={enabled ? 'claude' : 'subtle'}>{enabled ? 'ON' : 'OFF'}</Text>
}
