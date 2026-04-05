import { execSync } from 'node:child_process'
import type { LocalCommandCall } from '../../types/command.js'
import {
  checkForUpdateInBackground,
  getAvailableUpdate,
  getCurrentVersion,
  readUpdateCache,
} from '../../utils/updateCheck.js'

export const call: LocalCommandCall = async () => {
  // Refresh cache in background for next time
  checkForUpdateInBackground()

  const cache = readUpdateCache()
  const latest = getAvailableUpdate(cache)
  const current = getCurrentVersion()

  if (!latest) {
    const checked = cache
      ? ` (checked ${new Date(cache.checkedAt).toLocaleString()})`
      : ' (not yet checked — try again in a moment)'
    return {
      type: 'text',
      value: `snowcode v${current} is up to date${checked}`,
    }
  }

  // Try to update automatically
  try {
    execSync('npm install -g snowcode@latest', { stdio: 'inherit' })
    return {
      type: 'text',
      value: `✓ Updated snowcode v${current} → v${latest}\nRestart to use the new version.`,
    }
  } catch {
    // npm not available or failed — show manual instructions
    return {
      type: 'text',
      value: [
        `Update available: v${current} → v${latest}`,
        '',
        'Install with one of:',
        '  npm install -g snowcode@latest',
        '  bun install -g snowcode@latest',
        '  pnpm install -g snowcode@latest',
      ].join('\n'),
    }
  }
}
