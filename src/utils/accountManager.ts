/**
 * snowcode multi-account manager
 * Stores credentials for all providers in ~/.snowcode/accounts.json
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { getClaudeConfigHomeDir } from './envUtils.js'

export type AccountType =
  | 'anthropic_oauth'   // claude.ai OAuth token
  | 'anthropic_api'     // Anthropic API key
  | 'google_oauth'      // Antigravity/Google OAuth (refresh token)
  | 'codex_oauth'       // OpenAI/Codex OAuth (ChatGPT Plus/Pro)
  | 'openai_api'        // OpenAI/Codex API key
  | 'gemini_api'        // Gemini API key
  | 'zhipu_api'         // Z.AI GLM API key
  | 'vertex_api'        // Vertex AI API key

export interface Account {
  id: string
  type: AccountType
  label: string
  enabled: boolean
  /** For OAuth accounts: refresh token */
  refreshToken?: string
  /** For API key accounts */
  apiKey?: string
  /** For Google accounts: email */
  email?: string
  /** For Google accounts: GCP project ID */
  projectId?: string
  /** ISO timestamp */
  addedAt: string
}

export interface AccountsFile {
  version: 1
  accounts: Account[]
}

function getAccountsPath(): string {
  return join(getClaudeConfigHomeDir(), 'accounts.json')
}

function ensureDir(): void {
  const dir = getClaudeConfigHomeDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

export function loadAccounts(): AccountsFile {
  const path = getAccountsPath()
  if (!existsSync(path)) return { version: 1, accounts: [] }
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as AccountsFile
  } catch {
    return { version: 1, accounts: [] }
  }
}

export function saveAccounts(data: AccountsFile): void {
  ensureDir()
  writeFileSync(getAccountsPath(), JSON.stringify(data, null, 2), 'utf-8')
}

export function addAccount(account: Omit<Account, 'id' | 'addedAt'>): Account {
  const data = loadAccounts()
  const newAccount: Account = {
    ...account,
    id: Math.random().toString(36).slice(2, 10),
    addedAt: new Date().toISOString(),
  }
  data.accounts.push(newAccount)
  saveAccounts(data)
  return newAccount
}

export function removeAccount(id: string): void {
  const data = loadAccounts()
  data.accounts = data.accounts.filter(a => a.id !== id)
  saveAccounts(data)
}

export function toggleAccount(id: string, enabled: boolean): void {
  const data = loadAccounts()
  const acc = data.accounts.find(a => a.id === id)
  if (acc) {
    acc.enabled = enabled
    saveAccounts(data)
  }
}

export function updateAccount(
  id: string,
  updates: Partial<Omit<Account, 'id' | 'addedAt'>>,
): void {
  const data = loadAccounts()
  const acc = data.accounts.find(a => a.id === id)
  if (!acc) return
  Object.assign(acc, updates)
  saveAccounts(data)
}

export function getEnabledAccounts(type?: AccountType): Account[] {
  return loadAccounts().accounts.filter(
    a => a.enabled && (type == null || a.type === type),
  )
}

/** Pick the next enabled account of a type (round-robin by addedAt) */
export function pickNextAccount(type: AccountType): Account | undefined {
  return getEnabledAccounts(type)[0]
}

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  anthropic_oauth: 'Claude.ai (OAuth)',
  anthropic_api: 'Anthropic API key',
  google_oauth: 'Antigravity / Google (OAuth)',
  codex_oauth: 'OpenAI Codex (OAuth)',
  openai_api: 'OpenAI / Codex API key',
  gemini_api: 'Gemini API key',
  zhipu_api: 'Z.AI GLM API key',
  vertex_api: 'Vertex AI API key',
}
