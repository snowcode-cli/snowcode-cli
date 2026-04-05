import { getInitialSettings } from './settings/settings.js'

export function assertAntigravityOAuthConfig(): {
  clientId: string
  clientSecret: string
} {
  const settings = getInitialSettings() as {
    antigravityClientId?: string
    antigravityClientSecret?: string
  }
  const clientId = settings.antigravityClientId?.trim()
  const clientSecret = settings.antigravityClientSecret?.trim()
  const missing: string[] = []
  if (!clientId) missing.push('antigravityClientId')
  if (!clientSecret) missing.push('antigravityClientSecret')
  if (missing.length > 0) {
    throw new Error(
      `Antigravity OAuth is not configured in settings.json. Set ${missing.join(' and ')}.`,
    )
  }
  return { clientId, clientSecret }
}
