import { execSync } from 'node:child_process'
import type { LocalCommandCall } from '../../types/command.js'
import {
  getAvailableUpdate,
  getCurrentVersion,
  refreshUpdateCache,
} from '../../utils/updateCheck.js'

export const call: LocalCommandCall = async () => {
  const cache = await refreshUpdateCache({ force: true, timeoutMs: 5000 })
  const latest = getAvailableUpdate(cache)
  const current = getCurrentVersion()

  if (!cache) {
    return {
      type: 'text',
      value: 'Failed to check for updates. Try again in a moment.',
    }
  }

  if (!latest) {
    return {
      type: 'text',
      value: `snowcode v${current} is up to date (checked ${new Date(cache.checkedAt).toLocaleString()})`,
    }
  }

  try {
    execSync('npm install -g snowcode@latest', { stdio: 'inherit' })
    return {
      type: 'text',
      value: `Updated snowcode v${current} -> v${latest}\nRestart to use the new version.`,
    }
  } catch {
    return {
      type: 'text',
      value: [
        `Update available: v${current} -> v${latest}`,
        '',
        'Install with one of:',
        '  npm install -g snowcode@latest',
        '  bun install -g snowcode@latest',
        '  pnpm install -g snowcode@latest',
      ].join('\n'),
    }
  }
}
