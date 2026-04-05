import { useEffect, useState } from 'react'
import {
  type ClaudeAILimits,
  getCurrentClaudeAiLimits,
  statusListeners,
} from './claudeAiLimits.js'

export function useClaudeAiLimits(model?: string): ClaudeAILimits {
  const [, setVersion] = useState(0)

  useEffect(() => {
    const listener = (_newLimits: ClaudeAILimits) => {
      setVersion(version => version + 1)
    }
    statusListeners.add(listener)

    return () => {
      statusListeners.delete(listener)
    }
  }, [])

  return getCurrentClaudeAiLimits(model)
}
