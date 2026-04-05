import React, { useState } from 'react'
import type {
  CommandResultDisplay,
  LocalJSXCommandContext,
} from '../../commands.js'
import {
  type OptionWithDescription,
  Select,
} from '../../components/CustomSelect/select.js'
import { Dialog } from '../../components/design-system/Dialog.js'
import { Text } from '../../ink.js'
import type { ToolUseContext } from '../../Tool.js'
import type { LocalJSXCommandOnDone } from '../../types/command.js'
import {
  loadAccounts,
  ACCOUNT_TYPE_LABELS,
  type Account,
} from '../../utils/accountManager.js'
import { getFallbackOrder } from '../../utils/fallbackConfig.js'
import { call as usageCall } from '../usage/usage.js'

// ── Provider detection ────────────────────────────────────────────────────────

function getCurrentProviderGroup(): string {
  if (process.env.CLAUDE_CODE_USE_GEMINI === '1' || process.env.CLAUDE_CODE_USE_GEMINI === 'true') return 'google'
  if (process.env.CLAUDE_CODE_USE_OPENAI === '1' || process.env.CLAUDE_CODE_USE_OPENAI === 'true') return 'openai'
  return 'anthropic'
}

function accountProviderGroup(acc: Account): string {
  switch (acc.type) {
    case 'anthropic_oauth':
    case 'anthropic_api':
      return 'anthropic'
    case 'google_oauth':
    case 'gemini_api':
      return 'google'
    case 'openai_api':
    case 'codex_oauth':
      return 'openai'
    case 'zhipu_api':
      return 'zai'
    case 'vertex_api':
      return 'vertex'
    default:
      return 'unknown'
  }
}

// ── Apply a fallback account by mutating process.env ─────────────────────────

function applyAccount(acc: Account): void {
  switch (acc.type) {
    case 'anthropic_api':
      delete process.env.CLAUDE_CODE_USE_OPENAI
      delete process.env.CLAUDE_CODE_USE_GEMINI
      if (acc.apiKey) process.env.ANTHROPIC_API_KEY = acc.apiKey
      break
    case 'anthropic_oauth':
      delete process.env.CLAUDE_CODE_USE_OPENAI
      delete process.env.CLAUDE_CODE_USE_GEMINI
      break
    case 'openai_api':
      process.env.CLAUDE_CODE_USE_OPENAI = '1'
      delete process.env.CLAUDE_CODE_USE_GEMINI
      if (acc.apiKey) process.env.OPENAI_API_KEY = acc.apiKey
      // clear any provider-specific base URL
      delete process.env.OPENAI_BASE_URL
      break
    case 'codex_oauth':
      process.env.CLAUDE_CODE_USE_OPENAI = '1'
      delete process.env.CLAUDE_CODE_USE_GEMINI
      process.env.OPENAI_BASE_URL = 'https://chatgpt.com/backend-api'
      process.env.OPENAI_API_KEY = 'chatgpt-oauth'
      break
    case 'google_oauth':
      process.env.CLAUDE_CODE_USE_OPENAI = '1'
      delete process.env.CLAUDE_CODE_USE_GEMINI
      process.env.OPENAI_BASE_URL = 'https://cloudcode-pa.googleapis.com/v1beta/openai'
      break
    case 'gemini_api':
      process.env.CLAUDE_CODE_USE_GEMINI = '1'
      delete process.env.CLAUDE_CODE_USE_OPENAI
      if (acc.apiKey) process.env.GEMINI_API_KEY = acc.apiKey
      break
    case 'zhipu_api':
      process.env.CLAUDE_CODE_USE_OPENAI = '1'
      delete process.env.CLAUDE_CODE_USE_GEMINI
      process.env.OPENAI_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4'
      if (acc.apiKey) process.env.OPENAI_API_KEY = acc.apiKey
      break
    // vertex_api: complex auth, skip for now
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

type MainOption = 'fallback' | 'choose-fallback' | 'view-usage'

type Props = {
  onDone: (
    result?: string,
    options?: { display?: CommandResultDisplay } | undefined,
  ) => void
  context: ToolUseContext & LocalJSXCommandContext
}

function RateLimitOptionsMenu({ onDone, context }: Props): React.ReactNode {
  const [subCommandJSX, setSubCommandJSX] = useState<React.ReactNode>(null)
  const [choosingFallback, setChoosingFallback] = useState(false)

  const accounts = loadAccounts().accounts.filter(a => a.enabled)
  const currentGroup = getCurrentProviderGroup()
  // Use saved fallback order; fall back to first non-current account if none configured
  const fallbackOrder = getFallbackOrder()
  const firstFallback: Account | undefined =
    fallbackOrder.length > 0
      ? (fallbackOrder
          .map(id => accounts.find(a => a.id === id))
          .find(a => a !== undefined && accountProviderGroup(a) !== currentGroup) as Account | undefined)
        ?? accounts.find(a => accountProviderGroup(a) !== currentGroup)
      : accounts.find(a => accountProviderGroup(a) !== currentGroup)

  const fallbackLabel = firstFallback
    ? `Fallback (${ACCOUNT_TYPE_LABELS[firstFallback.type]})`
    : 'Fallback (no other accounts configured)'

  const mainOptions: OptionWithDescription<MainOption>[] = [
    { label: fallbackLabel, value: 'fallback' },
    { label: 'Choose Fallback', value: 'choose-fallback' },
    { label: 'View Usage', value: 'view-usage' },
  ]

  const fallbackOptions: OptionWithDescription<string>[] = accounts.map(a => ({
    label: a.label
      ? `${ACCOUNT_TYPE_LABELS[a.type]} — ${a.label}`
      : ACCOUNT_TYPE_LABELS[a.type],
    value: a.id,
  }))

  function handleCancel(): void {
    onDone(undefined, { display: 'skip' })
  }

  function handleSelect(value: MainOption): void {
    if (value === 'fallback') {
      if (firstFallback) {
        applyAccount(firstFallback)
        onDone(`Switched to ${ACCOUNT_TYPE_LABELS[firstFallback.type]} — resend your message`)
      } else {
        onDone('No fallback account configured. Add one via /auth', { display: 'skip' })
      }
    } else if (value === 'choose-fallback') {
      setChoosingFallback(true)
    } else if (value === 'view-usage') {
      void usageCall(onDone, context).then(jsx => {
        if (jsx) setSubCommandJSX(jsx)
      })
    }
  }

  function handleFallbackPick(accountId: string): void {
    const acc = accounts.find(a => a.id === accountId)
    if (acc) {
      applyAccount(acc)
      onDone(`Switched to ${ACCOUNT_TYPE_LABELS[acc.type]} — resend your message`)
    }
  }

  if (subCommandJSX) return <>{subCommandJSX}</>

  if (choosingFallback) {
    return (
      <Dialog
        title="Choose a fallback provider"
        onCancel={handleCancel}
        color="suggestion"
      >
        {fallbackOptions.length === 0 ? (
          <Text>No accounts configured. Run /auth to add one.</Text>
        ) : (
          <Select
            options={fallbackOptions}
            onChange={handleFallbackPick}
            visibleOptionCount={fallbackOptions.length}
          />
        )}
      </Dialog>
    )
  }

  return (
    <Dialog
      title="Rate limit reached — what now?"
      onCancel={handleCancel}
      color="suggestion"
    >
      <Select<MainOption>
        options={mainOptions}
        onChange={handleSelect}
        visibleOptionCount={mainOptions.length}
      />
    </Dialog>
  )
}

export async function call(
  onDone: LocalJSXCommandOnDone,
  context: ToolUseContext & LocalJSXCommandContext,
): Promise<React.ReactNode> {
  return <RateLimitOptionsMenu onDone={onDone} context={context} />
}
