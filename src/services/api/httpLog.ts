import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { logError } from '../../utils/log.js'

function redactSecrets(value: string): string {
  return value
    .replace(/(Authorization:\s*Bearer\s+)[^\s",}]+/gi, '$1<redacted>')
    .replace(/("accessToken"\s*:\s*")([^"]+)(")/gi, '$1<redacted>$3')
    .replace(/("access_token"\s*:\s*")([^"]+)(")/gi, '$1<redacted>$3')
    .replace(/("refresh_token"\s*:\s*")([^"]+)(")/gi, '$1<redacted>$3')
    .replace(/("apiKey"\s*:\s*")([^"]+)(")/gi, '$1<redacted>$3')
}

export function appendHttpLog(
  label: string,
  requestInfo: string,
  responseInfo: string,
): void {
  try {
    const dir = getClaudeConfigHomeDir()
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    appendFileSync(
      join(dir, 'http.log'),
      `[${new Date().toISOString()}] ${label}\nREQUEST:\n${redactSecrets(requestInfo)}\nRESPONSE:\n${redactSecrets(responseInfo)}\n\n`,
      { mode: 0o600 },
    )
  } catch (error) {
    logError(error)
  }
}
