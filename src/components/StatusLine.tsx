import { feature } from 'bun:bundle'
import * as React from 'react'
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { logEvent } from 'src/services/analytics/index.js'
import { useAppState, useSetAppState } from 'src/state/AppState.js'
import type { PermissionMode } from 'src/utils/permissions/PermissionMode.js'
import {
  getIsRemoteMode,
  getKairosActive,
  getMainThreadAgentType,
  getOriginalCwd,
  getSdkBetas,
  getSessionId,
} from '../bootstrap/state.js'
import { DEFAULT_OUTPUT_STYLE_NAME } from '../constants/outputStyles.js'
import { useNotifications } from '../context/notifications.js'
import {
  getTotalAPIDuration,
  getTotalCost,
  getTotalDuration,
  getTotalInputTokens,
  getTotalLinesAdded,
  getTotalLinesRemoved,
  getTotalOutputTokens,
} from '../cost-tracker.js'
import { useMainLoopModel } from '../hooks/useMainLoopModel.js'
import { type ReadonlySettings, useSettings } from '../hooks/useSettings.js'
import { Box, Text } from '../ink.js'
import { getRawUtilization } from '../services/claudeAiLimits.js'
import type { Message } from '../types/message.js'
import type { StatusLineCommandInput } from '../types/statusLine.js'
import type { VimMode } from '../types/textInputTypes.js'
import { checkHasTrustDialogAccepted } from '../utils/config.js'
import {
  calculateContextPercentages,
  getContextWindowForModel,
} from '../utils/context.js'
import { getCwd } from '../utils/cwd.js'
import { logForDebugging } from '../utils/debug.js'
import { formatDuration, formatTokens } from '../utils/format.js'
import { createBaseHookInput, executeStatusLineCommand } from '../utils/hooks.js'
import {
  getLastAssistantMessage,
  getMessagesAfterCompactBoundary,
} from '../utils/messages.js'
import {
  getRuntimeMainLoopModel,
  type ModelName,
  renderModelName,
} from '../utils/model/model.js'
import { getCurrentSessionTitle } from '../utils/sessionStorage.js'
import {
  doesMostRecentAssistantMessageExceed200k,
  getCurrentUsage,
  tokenCountWithEstimation,
} from '../utils/tokens.js'
import { getCurrentWorktreeSession } from '../utils/worktree.js'
import { isVimModeEnabled } from './PromptInput/utils.js'

export function statusLineShouldDisplay(_settings: ReadonlySettings): boolean {
  if (feature('KAIROS') && getKairosActive()) return false
  return true
}

const STATUS_BAR_FILL = '#2f80ed'
const STATUS_BAR_TRACK = '#17324d'
const STATUS_BAR_BRACKET = '#6b8fb8'
const STATUS_BAR_SEPARATOR = '#5a82af'
const STATUS_BAR_GLYPH = '█'

function formatStatusModelLabel(modelName: string): string {
  const separatorIndex = modelName.indexOf(':')
  if (separatorIndex === -1) return modelName
  return `${modelName.slice(0, separatorIndex)} - ${modelName.slice(separatorIndex + 1)}`
}

function StatusUsageBar({
  usedPercentage,
  width = 10,
}: {
  usedPercentage: number
  width?: number
}): React.ReactNode {
  const clamped = Math.max(0, Math.min(100, usedPercentage))
  const filled = Math.round((clamped / 100) * width)
  const empty = Math.max(0, width - filled)

  return (
    <Text>
      <Text color={STATUS_BAR_BRACKET}>[</Text>
      <Text color={STATUS_BAR_FILL}>{STATUS_BAR_GLYPH.repeat(filled)}</Text>
      <Text color={STATUS_BAR_TRACK}>{STATUS_BAR_GLYPH.repeat(empty)}</Text>
      <Text color={STATUS_BAR_BRACKET}>]</Text>
    </Text>
  )
}

function formatSessionDuration(ms: number): string {
  return formatDuration(ms, { hideTrailingZeros: true }).replace(/\s\d+s$/, '')
}

function getActiveContextMessages(messages: Message[]): Message[] {
  return getMessagesAfterCompactBoundary(messages)
}

function StatusLineElapsed(): React.ReactNode {
  const [, setTick] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => {
      setTick(prev => prev + 1)
    }, 1000)

    return () => clearInterval(interval)
  }, [])

  return formatSessionDuration(getTotalDuration())
}

function buildStatusLineCommandInput(
  permissionMode: PermissionMode,
  exceeds200kTokens: boolean,
  settings: ReadonlySettings,
  messages: Message[],
  addedDirs: string[],
  mainLoopModel: ModelName,
  vimMode?: VimMode,
): StatusLineCommandInput {
  const activeMessages = getActiveContextMessages(messages)
  const agentType = getMainThreadAgentType()
  const worktreeSession = getCurrentWorktreeSession()
  const runtimeModel = getRuntimeMainLoopModel({
    permissionMode,
    mainLoopModel,
    exceeds200kTokens,
  })
  const outputStyleName = settings?.outputStyle || DEFAULT_OUTPUT_STYLE_NAME
  const currentUsage = getCurrentUsage(activeMessages)
  const contextWindowSize = getContextWindowForModel(runtimeModel, getSdkBetas())
  const contextPercentages = calculateContextPercentages(
    currentUsage,
    contextWindowSize,
  )
  const sessionId = getSessionId()
  const sessionName = getCurrentSessionTitle(sessionId)
  const rawUtil = getRawUtilization(runtimeModel)
  const rateLimits: StatusLineCommandInput['rate_limits'] = {
    ...(rawUtil.five_hour && {
      five_hour: {
        used_percentage: rawUtil.five_hour.utilization * 100,
        resets_at: rawUtil.five_hour.resets_at,
      },
    }),
    ...(rawUtil.seven_day && {
      seven_day: {
        used_percentage: rawUtil.seven_day.utilization * 100,
        resets_at: rawUtil.seven_day.resets_at,
      },
    }),
  }

  return {
    ...createBaseHookInput(),
    ...(sessionName && { session_name: sessionName }),
    model: {
      id: runtimeModel,
      display_name: renderModelName(runtimeModel),
    },
    workspace: {
      current_dir: getCwd(),
      project_dir: getOriginalCwd(),
      added_dirs: addedDirs,
    },
    version: MACRO.VERSION,
    output_style: {
      name: outputStyleName,
    },
    cost: {
      total_cost_usd: getTotalCost(),
      total_duration_ms: getTotalDuration(),
      total_api_duration_ms: getTotalAPIDuration(),
      total_lines_added: getTotalLinesAdded(),
      total_lines_removed: getTotalLinesRemoved(),
    },
    context_window: {
      total_input_tokens: getTotalInputTokens(),
      total_output_tokens: getTotalOutputTokens(),
      context_window_size: contextWindowSize,
      current_usage: currentUsage,
      used_percentage: contextPercentages.used,
      remaining_percentage: contextPercentages.remaining,
    },
    exceeds_200k_tokens: exceeds200kTokens,
    ...((rateLimits.five_hour || rateLimits.seven_day) && {
      rate_limits: rateLimits,
    }),
    ...(isVimModeEnabled() && {
      vim: {
        mode: vimMode ?? 'INSERT',
      },
    }),
    ...(agentType && {
      agent: {
        name: agentType,
      },
    }),
    ...(getIsRemoteMode() && {
      remote: {
        session_id: getSessionId(),
      },
    }),
    ...(worktreeSession && {
      worktree: {
        name: worktreeSession.worktreeName,
        path: worktreeSession.worktreePath,
        branch: worktreeSession.worktreeBranch,
        original_cwd: worktreeSession.originalCwd,
        original_branch: worktreeSession.originalBranch,
      },
    }),
  }
}

type Props = {
  messagesRef: React.RefObject<Message[]>
  lastAssistantMessageId: string | null
  vimMode?: VimMode
}

export function getLastAssistantMessageId(messages: Message[]): string | null {
  return getLastAssistantMessage(messages)?.uuid ?? null
}

function StatusLineInner({
  messagesRef,
  lastAssistantMessageId,
  vimMode,
}: Props): React.ReactNode {
  const abortControllerRef = useRef<AbortController | undefined>(undefined)
  const permissionMode = useAppState(s => s.toolPermissionContext.mode)
  const additionalWorkingDirectories = useAppState(
    s => s.toolPermissionContext.additionalWorkingDirectories,
  )
  const setAppState = useSetAppState()
  const settings = useSettings()
  const { addNotification } = useNotifications()
  const mainLoopModel = useMainLoopModel()

  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const vimModeRef = useRef(vimMode)
  vimModeRef.current = vimMode
  const permissionModeRef = useRef(permissionMode)
  permissionModeRef.current = permissionMode
  const addedDirsRef = useRef(additionalWorkingDirectories)
  addedDirsRef.current = additionalWorkingDirectories
  const mainLoopModelRef = useRef(mainLoopModel)
  mainLoopModelRef.current = mainLoopModel

  const previousStateRef = useRef<{
    messageId: string | null
    exceeds200kTokens: boolean
    permissionMode: PermissionMode
    vimMode: VimMode | undefined
    mainLoopModel: ModelName
  }>({
    messageId: null,
    exceeds200kTokens: false,
    permissionMode,
    vimMode,
    mainLoopModel,
  })

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  )
  const logNextResultRef = useRef(true)

  const doUpdate = useCallback(async () => {
    abortControllerRef.current?.abort()
    const controller = new AbortController()
    abortControllerRef.current = controller
    const msgs = messagesRef.current
    const logResult = logNextResultRef.current
    logNextResultRef.current = false

    try {
      let exceeds200kTokens = previousStateRef.current.exceeds200kTokens
      const activeMessages = getActiveContextMessages(msgs)
      const currentMessageId = getLastAssistantMessageId(activeMessages)

      if (currentMessageId !== previousStateRef.current.messageId) {
        exceeds200kTokens =
          doesMostRecentAssistantMessageExceed200k(activeMessages)
        previousStateRef.current.messageId = currentMessageId
        previousStateRef.current.exceeds200kTokens = exceeds200kTokens
      }

      const statusInput = buildStatusLineCommandInput(
        permissionModeRef.current,
        exceeds200kTokens,
        settingsRef.current,
        msgs,
        Array.from(addedDirsRef.current.keys()),
        mainLoopModelRef.current,
        vimModeRef.current,
      )
      const text = await executeStatusLineCommand(
        statusInput,
        controller.signal,
        undefined,
        logResult,
      )

      if (!controller.signal.aborted) {
        setAppState(prev => {
          if (prev.statusLineText === text) return prev
          return {
            ...prev,
            statusLineText: text,
          }
        })
      }
    } catch {
      // ignore hook errors
    }
  }, [messagesRef, setAppState])

  const scheduleUpdate = useCallback(() => {
    if (debounceTimerRef.current !== undefined) {
      clearTimeout(debounceTimerRef.current)
    }

    debounceTimerRef.current = setTimeout(
      (ref, update) => {
        ref.current = undefined
        void update()
      },
      300,
      debounceTimerRef,
      doUpdate,
    )
  }, [doUpdate])

  useEffect(() => {
    if (
      lastAssistantMessageId !== previousStateRef.current.messageId ||
      permissionMode !== previousStateRef.current.permissionMode ||
      vimMode !== previousStateRef.current.vimMode ||
      mainLoopModel !== previousStateRef.current.mainLoopModel
    ) {
      previousStateRef.current.permissionMode = permissionMode
      previousStateRef.current.vimMode = vimMode
      previousStateRef.current.mainLoopModel = mainLoopModel
      scheduleUpdate()
    }
  }, [lastAssistantMessageId, permissionMode, vimMode, mainLoopModel, scheduleUpdate])

  const statusLineCommand = settings?.statusLine?.command
  const isFirstSettingsRender = useRef(true)
  useEffect(() => {
    if (isFirstSettingsRender.current) {
      isFirstSettingsRender.current = false
      return
    }
    logNextResultRef.current = true
    void doUpdate()
  }, [statusLineCommand, doUpdate])

  useEffect(() => {
    const statusLine = settings?.statusLine
    if (statusLine) {
      logEvent('tengu_status_line_mount', {
        command_length: statusLine.command.length,
        padding: statusLine.padding,
      })
      if (settings.disableAllHooks === true) {
        logForDebugging('Status line is configured but disableAllHooks is true', {
          level: 'warn',
        })
      }
      if (!checkHasTrustDialogAccepted()) {
        addNotification({
          key: 'statusline-trust-blocked',
          text: 'statusline skipped · restart to fix',
          color: 'warning',
          priority: 'low',
        })
        logForDebugging(
          'Status line command skipped: workspace trust not accepted',
          { level: 'warn' },
        )
      }
    }
  }, [])

  useEffect(() => {
    void doUpdate()
    return () => {
      abortControllerRef.current?.abort()
      if (debounceTimerRef.current !== undefined) {
        clearTimeout(debounceTimerRef.current)
      }
    }
  }, [])

  const paddingX = settings?.statusLine?.padding ?? 0
  const runtimeModel = getRuntimeMainLoopModel({
    permissionMode,
    mainLoopModel,
    exceeds200kTokens: previousStateRef.current.exceeds200kTokens,
  })
  const contextWindowSize = getContextWindowForModel(runtimeModel, getSdkBetas())
  const activeMessages = getActiveContextMessages(messagesRef.current)
  const currentTokens = tokenCountWithEstimation(activeMessages)
  const currentUsage = getCurrentUsage(activeMessages) ?? {
    input_tokens: currentTokens,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  }
  const contextPercentages = calculateContextPercentages(
    currentUsage,
    contextWindowSize,
  )
  const usedPercentage = Math.max(
    0,
    Math.min(100, Math.round(contextPercentages.used)),
  )
  const modelText = formatStatusModelLabel(renderModelName(runtimeModel))
  const tokenText = `${formatTokens(currentTokens)}/${formatTokens(contextWindowSize)}`
  return (
    <Box paddingX={paddingX}>
      <Text color="#b8ccea" wrap="truncate-end">
        {modelText}
      </Text>
      <Text color={STATUS_BAR_SEPARATOR}> | </Text>
      <Text dimColor>{tokenText}</Text>
      <Text> </Text>
      <StatusUsageBar usedPercentage={usedPercentage} />
      <Text color="#8ca9c9"> {usedPercentage}%</Text>
      <Text color={STATUS_BAR_SEPARATOR}> | </Text>
      <Text dimColor>
        <StatusLineElapsed />
      </Text>
    </Box>
  )
}

export const StatusLine = memo(StatusLineInner)
