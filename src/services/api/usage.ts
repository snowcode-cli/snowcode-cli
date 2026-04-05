import axios from 'axios'
import { getOauthConfig } from '../../constants/oauth.js'
import {
  getClaudeAIOAuthTokens,
  hasProfileScope,
  isClaudeAISubscriber,
} from '../../utils/auth.js'
import { appendHttpLog } from './httpLog.js'
import { getAuthHeaders } from '../../utils/http.js'
import { getClaudeCodeUserAgent } from '../../utils/userAgent.js'
import { isOAuthTokenExpired } from '../oauth/client.js'

export type RateLimit = {
  utilization: number | null // a percentage from 0 to 100
  resets_at: string | null // ISO 8601 timestamp
}

export type ExtraUsage = {
  is_enabled: boolean
  monthly_limit: number | null
  used_credits: number | null
  utilization: number | null
}

export type Utilization = {
  five_hour?: RateLimit | null
  seven_day?: RateLimit | null
  seven_day_oauth_apps?: RateLimit | null
  seven_day_opus?: RateLimit | null
  seven_day_sonnet?: RateLimit | null
  extra_usage?: ExtraUsage | null
}

export async function fetchUtilization(accessToken?: string): Promise<Utilization | null> {
  if (accessToken) {
    // Fetch usage for a specific account using its access token directly
    const headers = {
      'Content-Type': 'application/json',
      'User-Agent': getClaudeCodeUserAgent(),
      'Authorization': `Bearer ${accessToken}`,
      'anthropic-beta': 'oauth-2025-04-20',
    }
    const url = `${getOauthConfig().BASE_API_URL}/api/oauth/usage`
    const response = await axios.get<Utilization>(url, { headers, timeout: 5000 })
    appendHttpLog(
      'usage claude success',
      `GET ${url}\n${Object.entries(headers).map(([key, value]) => `${key}: ${value}`).join('\n')}`,
      `status=${response.status}\n<json response body omitted>`,
    )
    return response.data
  }

  if (!isClaudeAISubscriber() || !hasProfileScope()) {
    return {}
  }

  // Skip API call if OAuth token is expired to avoid 401 errors
  const tokens = getClaudeAIOAuthTokens()
  if (tokens && isOAuthTokenExpired(tokens.expiresAt)) {
    return null
  }

  const authResult = getAuthHeaders()
  if (authResult.error) {
    throw new Error(`Auth error: ${authResult.error}`)
  }

  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': getClaudeCodeUserAgent(),
    ...authResult.headers,
  }

  const url = `${getOauthConfig().BASE_API_URL}/api/oauth/usage`

  try {
    const response = await axios.get<Utilization>(url, {
      headers,
      timeout: 5000, // 5 second timeout
    })

    appendHttpLog(
      'usage claude success',
      `GET ${url}\n${Object.entries(headers).map(([key, value]) => `${key}: ${value}`).join('\n')}`,
      `status=${response.status}\n<json response body omitted>`,
    )

    return response.data
  } catch (error) {
    if (axios.isAxiosError(error)) {
      appendHttpLog(
        'usage claude error',
        `GET ${url}\n${Object.entries(headers).map(([key, value]) => `${key}: ${value}`).join('\n')}`,
        `status=${error.response?.status ?? 'unknown'}\n${typeof error.response?.data === 'string' ? error.response.data : JSON.stringify(error.response?.data ?? {})}`,
      )
    }
    throw error
  }
}
