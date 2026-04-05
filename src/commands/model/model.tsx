import chalk from 'chalk'
import * as React from 'react'
import type { CommandResultDisplay } from '../../commands.js'
import { ModelPicker } from '../../components/ModelPicker.js'
import { COMMON_HELP_ARGS, COMMON_INFO_ARGS } from '../../constants/xml.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js'
import { useAppState, useSetAppState } from '../../state/AppState.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import { isBilledAsExtraUsage } from '../../utils/extraUsage.js'
import {
  clearFastModeCooldown,
  isFastModeAvailable,
  isFastModeEnabled,
  isFastModeSupportedByModel,
} from '../../utils/fastMode.js'
import { MODEL_ALIASES } from '../../utils/model/aliases.js'
import {
  checkOpus1mAccess,
  checkSonnet1mAccess,
} from '../../utils/model/check1mAccess.js'
import {
  getDefaultMainLoopModelSetting,
  isOpus1mMergeEnabled,
  renderDefaultModelSetting,
} from '../../utils/model/model.js'
import { isModelAllowed } from '../../utils/model/modelAllowlist.js'
import { validateModel } from '../../utils/model/validateModel.js'
import { getInferenceControlStatusNote } from '../../utils/reasoningControl.js'

function renderModelLabel(model: string | null): string {
  const rendered = renderDefaultModelSetting(
    model ?? getDefaultMainLoopModelSetting(),
  )
  return model === null ? `${rendered} (default)` : rendered
}

function isKnownAlias(model: string): boolean {
  return (MODEL_ALIASES as readonly string[]).includes(
    model.toLowerCase().trim(),
  )
}

function isOpus1mUnavailable(model: string): boolean {
  const normalized = model.toLowerCase()
  return (
    !checkOpus1mAccess() &&
    !isOpus1mMergeEnabled() &&
    normalized.includes('opus') &&
    normalized.includes('[1m]')
  )
}

function isSonnet1mUnavailable(model: string): boolean {
  const normalized = model.toLowerCase()
  return (
    !checkSonnet1mAccess() &&
    (normalized.includes('sonnet[1m]') ||
      normalized.includes('sonnet-4-6[1m]'))
  )
}

function ModelPickerWrapper({
  onDone,
}: {
  onDone: (
    result?: string,
    options?: { display?: CommandResultDisplay },
  ) => void
}): React.ReactNode {
  const mainLoopModel = useAppState(s => s.mainLoopModel)
  const mainLoopModelForSession = useAppState(s => s.mainLoopModelForSession)
  const isFastMode = useAppState(s => s.fastMode)
  const setAppState = useSetAppState()

  const handleCancel = React.useCallback((): void => {
    logEvent('tengu_model_command_menu', {
      action:
        'cancel' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    onDone(`Kept model as ${chalk.bold(renderModelLabel(mainLoopModel))}`, {
      display: 'system',
    })
  }, [mainLoopModel, onDone])

  const handleSelect = React.useCallback(
    (model: string | null, controlSummary: string | undefined): void => {
      logEvent('tengu_model_command_menu', {
        action: (model ??
          'default') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        from_model: (mainLoopModel ??
          'default') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        to_model: (model ??
          'default') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })

      const shouldDisableFastMode =
        isFastModeEnabled() &&
        isFastMode &&
        !isFastModeSupportedByModel(model)

      setAppState(prev => ({
        ...prev,
        mainLoopModel: model,
        mainLoopModelForSession: null,
        ...(shouldDisableFastMode ? { fastMode: false } : {}),
      }))

      let message = `Set model to ${chalk.bold(renderModelLabel(model))}`
      if (controlSummary) {
        message += ` with ${chalk.bold(controlSummary)}`
      }

      let wasFastModeToggledOn: boolean | undefined
      if (isFastModeEnabled()) {
        clearFastModeCooldown()
        if (shouldDisableFastMode) {
          wasFastModeToggledOn = false
        } else if (
          isFastModeSupportedByModel(model) &&
          isFastModeAvailable() &&
          isFastMode
        ) {
          message += ' · Fast mode ON'
          wasFastModeToggledOn = true
        }
      }

      if (
        isBilledAsExtraUsage(
          model,
          wasFastModeToggledOn === true,
          isOpus1mMergeEnabled(),
        )
      ) {
        message += ' · Billed as extra usage'
      }
      if (wasFastModeToggledOn === false) {
        message += ' · Fast mode OFF'
      }

      onDone(message)
    },
    [isFastMode, mainLoopModel, onDone, setAppState],
  )

  const showFastModeNotice =
    isFastModeEnabled() &&
    isFastMode &&
    isFastModeSupportedByModel(mainLoopModel) &&
    isFastModeAvailable()

  return (
    <ModelPicker
      initial={mainLoopModel}
      sessionModel={mainLoopModelForSession}
      onSelect={handleSelect}
      onCancel={handleCancel}
      isStandaloneCommand
      showFastModeNotice={showFastModeNotice}
    />
  )
}

function SetModelAndClose({
  args,
  onDone,
}: {
  args: string
  onDone: (
    result?: string,
    options?: { display?: CommandResultDisplay },
  ) => void
}): React.ReactNode {
  const isFastMode = useAppState(s => s.fastMode)
  const setAppState = useSetAppState()
  const model = args === 'default' ? null : args

  React.useEffect(() => {
    async function handleModelChange(): Promise<void> {
      if (model && !isModelAllowed(model)) {
        onDone(
          `Model '${model}' is not available. Your organization restricts model selection.`,
          { display: 'system' },
        )
        return
      }

      if (model && isOpus1mUnavailable(model)) {
        onDone(
          'Opus 4.6 with 1M context is not available for your account. Learn more: https://code.claude.com/docs/en/model-config#extended-context-with-1m',
          { display: 'system' },
        )
        return
      }
      if (model && isSonnet1mUnavailable(model)) {
        onDone(
          'Sonnet 4.6 with 1M context is not available for your account. Learn more: https://code.claude.com/docs/en/model-config#extended-context-with-1m',
          { display: 'system' },
        )
        return
      }

      if (!model) {
        setModel(null)
        return
      }

      if (isKnownAlias(model)) {
        setModel(model)
        return
      }

      try {
        const { valid, error } = await validateModel(model)
        if (valid) {
          setModel(model)
        } else {
          onDone(error || `Model '${model}' not found`, {
            display: 'system',
          })
        }
      } catch (error) {
        onDone(`Failed to validate model: ${(error as Error).message}`, {
          display: 'system',
        })
      }
    }

    function setModel(modelValue: string | null): void {
      const shouldDisableFastMode =
        isFastModeEnabled() &&
        isFastMode &&
        !isFastModeSupportedByModel(modelValue)

      setAppState(prev => ({
        ...prev,
        mainLoopModel: modelValue,
        mainLoopModelForSession: null,
        ...(shouldDisableFastMode ? { fastMode: false } : {}),
      }))

      let message = `Set model to ${chalk.bold(renderModelLabel(modelValue))}`
      let wasFastModeToggledOn: boolean | undefined

      if (isFastModeEnabled()) {
        clearFastModeCooldown()
        if (shouldDisableFastMode) {
          wasFastModeToggledOn = false
        } else if (
          isFastModeSupportedByModel(modelValue) &&
          isFastMode
        ) {
          message += ' · Fast mode ON'
          wasFastModeToggledOn = true
        }
      }

      if (
        isBilledAsExtraUsage(
          modelValue,
          wasFastModeToggledOn === true,
          isOpus1mMergeEnabled(),
        )
      ) {
        message += ' · Billed as extra usage'
      }
      if (wasFastModeToggledOn === false) {
        message += ' · Fast mode OFF'
      }

      onDone(message)
    }

    void handleModelChange()
  }, [isFastMode, model, onDone, setAppState])

  return null
}

function ShowModelAndClose({
  onDone,
}: {
  onDone: (result?: string) => void
}): React.ReactNode {
  const mainLoopModel = useAppState(s => s.mainLoopModel)
  const mainLoopModelForSession = useAppState(s => s.mainLoopModelForSession)
  const effortValue = useAppState(s => s.effortValue)
  const thinkingEnabled = useAppState(s => s.thinkingEnabled)

  const effectiveBaseModel = mainLoopModel ?? getDefaultMainLoopModelSetting()
  const inferenceInfo = getInferenceControlStatusNote(effectiveBaseModel, {
    effortValue,
    thinkingEnabled,
  })
  const displayModel = renderModelLabel(mainLoopModel)

  React.useEffect(() => {
    if (mainLoopModelForSession) {
      onDone(
        `Current model: ${chalk.bold(
          renderModelLabel(mainLoopModelForSession),
        )} (session override from plan mode)\nBase model: ${displayModel}${inferenceInfo}`,
      )
      return
    }

    onDone(`Current model: ${displayModel}${inferenceInfo}`)
  }, [displayModel, inferenceInfo, mainLoopModelForSession, onDone])

  return null
}

export const call: LocalJSXCommandCall = async (onDone, _context, args) => {
  args = args?.trim() || ''

  if (COMMON_INFO_ARGS.includes(args)) {
    logEvent('tengu_model_command_inline_help', {
      args: args as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    return <ShowModelAndClose onDone={onDone} />
  }

  if (COMMON_HELP_ARGS.includes(args)) {
    onDone(
      'Run /model to open the model selection menu, or /model [modelName] to set the model.',
      { display: 'system' },
    )
    return
  }

  if (args) {
    logEvent('tengu_model_command_inline', {
      args: args as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    return <SetModelAndClose args={args} onDone={onDone} />
  }

  return <ModelPickerWrapper onDone={onDone} />
}
