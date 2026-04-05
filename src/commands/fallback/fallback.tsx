/**
 * /fallback — configure provider fallback order
 *
 * Shows all enabled accounts. User can:
 *  • Toggle an account in/out of the fallback list
 *  • Move accounts up/down to set priority
 */

import * as React from 'react'
import { useState } from 'react'
import { Box, Text } from '../../ink.js'
import { useInput } from '../../ink.js'
import { Select, type OptionWithDescription } from '../../components/CustomSelect/select.js'
import { Dialog } from '../../components/design-system/Dialog.js'
import { loadAccounts, ACCOUNT_TYPE_LABELS, type Account } from '../../utils/accountManager.js'
import {
  loadFallbackConfig,
  addToFallback,
  removeFromFallback,
  moveFallback,
  setFallbackOrder,
} from '../../utils/fallbackConfig.js'
import type { LocalJSXCommandCall } from '../../types/command.js'

// ── Colors ────────────────────────────────────────────────────────────────────

const BLUE = '#4696ff'
const DIM = '#5a82af'
const ACCENT = '#64b4ff'
const OK = '#44cc88'
const GREY = '#666677'

// ── Types ─────────────────────────────────────────────────────────────────────

type Screen = 'list' | 'actions'

type AccountAction = 'add' | 'remove' | 'move-up' | 'move-down' | 'back'

// ── Main component ────────────────────────────────────────────────────────────

function FallbackManager({ onDone }: { onDone: () => void }) {
  const [screen, setScreen] = useState<Screen>('list')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [, forceUpdate] = useState(0)

  const refresh = () => forceUpdate(n => n + 1)

  const accounts = loadAccounts().accounts.filter(a => a.enabled)
  const fallbackOrder = loadFallbackConfig().order
  // Only keep IDs that still exist as enabled accounts
  const validOrder = fallbackOrder.filter(id => accounts.some(a => a.id === id))
  const inFallback = accounts.filter(a => validOrder.includes(a.id))
    .sort((a, b) => validOrder.indexOf(a.id) - validOrder.indexOf(b.id))
  const notInFallback = accounts.filter(a => !validOrder.includes(a.id))

  // Sync valid order (prune deleted accounts)
  React.useEffect(() => {
    if (validOrder.length !== fallbackOrder.length) {
      setFallbackOrder(validOrder)
    }
  }, [])

  useInput((_, key) => {
    if (key.escape) {
      if (screen === 'actions') {
        setScreen('list')
        setSelectedId(null)
      } else {
        onDone()
      }
    }
  })

  // ── Account list screen ───────────────────────────────────────────────────

  if (screen === 'list') {
    const listOptions: OptionWithDescription<string>[] = [
      ...inFallback.map((a, idx) => ({
        label: `${idx + 1}. ${ACCOUNT_TYPE_LABELS[a.type]}${a.label ? ' — ' + a.label : ''}`,
        value: a.id,
        description: 'In fallback list',
      })),
      ...notInFallback.map(a => ({
        label: `   ${ACCOUNT_TYPE_LABELS[a.type]}${a.label ? ' — ' + a.label : ''}`,
        value: a.id,
        description: 'Not in fallback list',
      })),
    ]

    if (listOptions.length === 0) {
      return (
        <Box flexDirection="column" paddingTop={1}>
          <Text color={ACCENT} bold>  /fallback  </Text>
          <Text color={DIM}>  No accounts configured. Add one via /auth first.</Text>
          <Text color={DIM}>  Press Esc to close.</Text>
        </Box>
      )
    }

    return (
      <Box flexDirection="column" paddingTop={1}>
        <Box marginBottom={1}>
          <Text color={BLUE} bold>{'─── '}</Text>
          <Text color={ACCENT} bold>Fallback Order</Text>
          <Text color={BLUE} bold>{' ───'}</Text>
          <Text color={DIM}>  Select an account to configure  </Text>
          <Text color={GREY}>Esc = close</Text>
        </Box>
        {inFallback.length > 0 && (
          <Box marginBottom={1}>
            <Text color={DIM}>  Numbered = active fallback order  </Text>
            <Text color={OK}>●</Text>
            <Text color={DIM}> will be tried first when rate-limited</Text>
          </Box>
        )}
        {inFallback.length === 0 && (
          <Box marginBottom={1}>
            <Text color={DIM}>  No fallback order set. Add accounts below.</Text>
          </Box>
        )}
        <Select
          options={listOptions}
          onChange={(id: string) => {
            setSelectedId(id)
            setScreen('actions')
          }}
          visibleOptionCount={Math.min(listOptions.length, 10)}
        />
      </Box>
    )
  }

  // ── Action screen ─────────────────────────────────────────────────────────

  const account = accounts.find(a => a.id === selectedId)
  if (!account) {
    setScreen('list')
    return null
  }

  const isInFallback = validOrder.includes(account.id)
  const idx = validOrder.indexOf(account.id)
  const isFirst = idx === 0
  const isLast = idx === validOrder.length - 1

  const actionOptions: OptionWithDescription<AccountAction>[] = []

  if (!isInFallback) {
    actionOptions.push({ label: 'Add to fallback list', value: 'add' })
  } else {
    if (!isFirst) actionOptions.push({ label: '↑ Move up (higher priority)', value: 'move-up' })
    if (!isLast) actionOptions.push({ label: '↓ Move down (lower priority)', value: 'move-down' })
    actionOptions.push({ label: 'Remove from fallback list', value: 'remove' })
  }
  actionOptions.push({ label: '← Back', value: 'back' })

  function handleAction(action: AccountAction) {
    if (!account) return
    if (action === 'add') {
      addToFallback(account.id)
    } else if (action === 'remove') {
      removeFromFallback(account.id)
    } else if (action === 'move-up') {
      moveFallback(account.id, 'up')
    } else if (action === 'move-down') {
      moveFallback(account.id, 'down')
    }
    if (action === 'back') {
      setScreen('list')
      setSelectedId(null)
    } else {
      refresh()
      setScreen('list')
    }
  }

  const accountLabel = `${ACCOUNT_TYPE_LABELS[account.type]}${account.label ? ' — ' + account.label : ''}`

  return (
    <Dialog
      title={accountLabel}
      onCancel={() => { setScreen('list'); setSelectedId(null) }}
      color="suggestion"
    >
      <Box flexDirection="column">
        {isInFallback && (
          <Box marginBottom={1}>
            <Text color={DIM}>  Current position: </Text>
            <Text color={OK} bold>#{idx + 1}</Text>
            <Text color={DIM}> of {validOrder.length}</Text>
          </Box>
        )}
        <Select
          options={actionOptions}
          onChange={handleAction}
          visibleOptionCount={actionOptions.length}
        />
      </Box>
    </Dialog>
  )
}

// ── Export ────────────────────────────────────────────────────────────────────

export const call: LocalJSXCommandCall = async (onDone) => {
  return <FallbackManager onDone={() => onDone()} />
}
