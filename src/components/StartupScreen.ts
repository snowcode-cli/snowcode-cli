/**
 * snowcode startup screen — filled-block text logo with snow gradient.
 * Called once at CLI startup before the Ink UI renders.
 */

import {
  checkForUpdateInBackground,
  getAvailableUpdate,
  getCurrentVersion,
  readUpdateCache,
} from '../utils/updateCheck.js'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'

// MACRO.DISPLAY_VERSION / MACRO.VERSION are inlined at build time by Bun.build
declare const MACRO: { DISPLAY_VERSION?: string; VERSION: string }

const ESC = '\x1b['
const RESET = `${ESC}0m`
const DIM = `${ESC}2m`

type RGB = [number, number, number]
const rgb = (r: number, g: number, b: number) => `${ESC}38;2;${r};${g};${b}m`

function lerp(a: RGB, b: RGB, t: number): RGB {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ]
}

function gradAt(stops: RGB[], t: number): RGB {
  const c = Math.max(0, Math.min(1, t))
  const s = c * (stops.length - 1)
  const i = Math.floor(s)
  if (i >= stops.length - 1) return stops[stops.length - 1]
  return lerp(stops[i], stops[i + 1], s - i)
}

function paintLine(text: string, stops: RGB[], lineT: number): string {
  let out = ''
  for (let i = 0; i < text.length; i++) {
    const t = text.length > 1 ? lineT * 0.5 + (i / (text.length - 1)) * 0.5 : lineT
    const [r, g, b] = gradAt(stops, t)
    out += `${rgb(r, g, b)}${text[i]}`
  }
  return out + RESET
}

// ─── Colors ───────────────────────────────────────────────────────────────────

const SNOW_GRAD: RGB[] = [
  [60, 130, 255],   // deep blue
  [80, 160, 255],   // medium blue
  [110, 190, 255],  // sky blue
  [150, 215, 255],  // ice blue
  [190, 235, 255],  // pale ice
  [220, 245, 255],  // near white
]

const ACCENT: RGB = [100, 180, 255]
const CREAM: RGB = [200, 230, 255]
const DIMCOL: RGB = [90, 130, 175]
const BORDER: RGB = [60, 100, 155]

// ─── Filled Block Text Logo ───────────────────────────────────────────────────

const LOGO_SNOW = [
  ` \u2588\u2588\u2588\u2588\u2588\u2588\u2557  \u2588\u2588\u2588\u2557  \u2588\u2588\u2557  \u2588\u2588\u2588\u2588\u2588\u2588\u2557  \u2588\u2588\u2557    \u2588\u2588\u2557`,
  `\u2588\u2588\u2554\u2550\u2550\u2550\u2550\u255d  \u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2551 \u2588\u2588\u2554\u2550\u2550\u2550\u2588\u2588\u2557 \u2588\u2588\u2551    \u2588\u2588\u2551`,
  `\u255a\u2588\u2588\u2588\u2588\u2588\u2557   \u2588\u2588\u2554\u2588\u2588\u2557\u2588\u2588\u2551 \u2588\u2588\u2551   \u2588\u2588\u2551 \u2588\u2588\u2551 \u2588\u2557 \u2588\u2588\u2551`,
  ` \u255a\u2550\u2550\u2550\u2550\u2588\u2588\u2557 \u2588\u2588\u2551\u255a\u2588\u2588\u2588\u2588\u2551 \u2588\u2588\u2551   \u2588\u2588\u2551 \u2588\u2588\u2551\u2588\u2588\u2588\u2557\u2588\u2588\u2551`,
  ` \u2588\u2588\u2588\u2588\u2588\u2588\u2554\u255d \u2588\u2588\u2551 \u255a\u2588\u2588\u2588\u2551 \u255a\u2588\u2588\u2588\u2588\u2588\u2588\u2554\u255d \u255a\u2588\u2588\u2588\u2554\u2588\u2588\u2588\u2554\u255d`,
  ` \u255a\u2550\u2550\u2550\u2550\u2550\u255d  \u255a\u2550\u255d  \u255a\u2550\u2550\u255d  \u255a\u2550\u2550\u2550\u2550\u2550\u255d   \u255a\u2550\u2550\u255d\u255a\u2550\u2550\u255d `,
]

const LOGO_CODE = [
  `   \u2588\u2588\u2588\u2588\u2588\u2588\u2557  \u2588\u2588\u2588\u2588\u2588\u2588\u2557  \u2588\u2588\u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557`,
  `  \u2588\u2588\u2554\u2550\u2550\u2550\u2550\u255d \u2588\u2588\u2554\u2550\u2550\u2550\u2588\u2588\u2557\u2588\u2588\u2554\u2550\u2550\u2550\u2588\u2588\u2557\u2588\u2588\u2554\u2550\u2550\u2550\u2550\u255d`,
  `  \u2588\u2588\u2551      \u2588\u2588\u2551   \u2588\u2588\u2551\u2588\u2588\u2551   \u2588\u2588\u2551\u2588\u2588\u2588\u2588\u2588\u2557  `,
  `  \u2588\u2588\u2551      \u2588\u2588\u2551   \u2588\u2588\u2551\u2588\u2588\u2551   \u2588\u2588\u2551\u2588\u2588\u2554\u2550\u2550\u255d  `,
  `  \u255a\u2588\u2588\u2588\u2588\u2588\u2588\u2557 \u255a\u2588\u2588\u2588\u2588\u2588\u2588\u2554\u255d\u255a\u2588\u2588\u2588\u2588\u2588\u2588\u2554\u255d\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557`,
  `   \u255a\u2550\u2550\u2550\u2550\u2550\u255d  \u255a\u2550\u2550\u2550\u2550\u2550\u255d  \u255a\u2550\u2550\u2550\u2550\u2550\u255d \u255a\u2550\u2550\u2550\u2550\u2550\u2550\u255d`,
]

// ─── Provider detection ───────────────────────────────────────────────────────

/** Read model from settings.json in the active Snowcode config dir */
function readSettingsModel(): string | undefined {
  try {
    const { existsSync, readFileSync } = require('node:fs') as typeof import('node:fs')
    const { join } = require('node:path') as typeof import('node:path')
    const configDir = getClaudeConfigHomeDir()
    const settingsPath = join(configDir, 'settings.json')
    if (!existsSync(settingsPath)) return undefined
    const data = JSON.parse(readFileSync(settingsPath, 'utf-8'))
    return typeof data?.model === 'string' ? data.model : undefined
  } catch {
    return undefined
  }
}

const PROVIDER_NAMES: Record<string, string> = {
  vertex: 'Vertex AI',
  google: 'Google',
  openai: 'OpenAI',
  codex: 'Codex',
  zai: 'Z.AI',
  antigravity: 'Antigravity',
  gemini: 'Google Gemini',
  anthropic: 'Anthropic',
}

function detectProvider(): { name: string; model: string; baseUrl: string; isLocal: boolean } {
  // 1. Check env vars for explicit overrides (legacy / local models)
  const useGemini = process.env.CLAUDE_CODE_USE_GEMINI === '1' || process.env.CLAUDE_CODE_USE_GEMINI === 'true'
  const useOpenAI = process.env.CLAUDE_CODE_USE_OPENAI === '1' || process.env.CLAUDE_CODE_USE_OPENAI === 'true'

  // 2. Check saved model setting (from /model picker)
  const savedModel = readSettingsModel() || process.env.OPENAI_MODEL || process.env.GEMINI_MODEL || process.env.ANTHROPIC_MODEL

  // If saved model has a provider prefix (e.g. "vertex:gemini-3.1-pro-preview"), use it
  if (savedModel) {
    const colonIdx = savedModel.indexOf(':')
    if (colonIdx !== -1) {
      const prefix = savedModel.slice(0, colonIdx).toLowerCase()
      const modelName = savedModel.slice(colonIdx + 1)
      if (prefix !== 'anthropic') {
        const providerName = PROVIDER_NAMES[prefix] ?? prefix
        const baseUrl =
          prefix === 'vertex'
            ? 'https://aiplatform.googleapis.com/v1'
            : prefix === 'antigravity'
              ? 'https://daily-cloudcode-pa.googleapis.com'
              : prefix === 'gemini'
                ? 'https://generativelanguage.googleapis.com/v1beta/openai'
                : prefix === 'zai'
                  ? 'https://open.bigmodel.cn/api/paas/v4'
                  : prefix === 'codex'
                    ? 'https://chatgpt.com/backend-api/codex'
                    : process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'
        return { name: providerName, model: modelName, baseUrl, isLocal: false }
      }
    }
  }

  if (useGemini) {
    const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash'
    const baseUrl = process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai'
    return { name: 'Google Gemini', model, baseUrl, isLocal: false }
  }

  if (useOpenAI) {
    const model = process.env.OPENAI_MODEL || 'gpt-4o'
    const baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'
    const isLocal = /localhost|127\.0\.0\.1|0\.0\.0\.0/.test(baseUrl)
    let name = 'OpenAI'
    if (/deepseek/i.test(baseUrl) || /deepseek/i.test(model))       name = 'DeepSeek'
    else if (/openrouter/i.test(baseUrl))                             name = 'OpenRouter'
    else if (/together/i.test(baseUrl))                               name = 'Together AI'
    else if (/groq/i.test(baseUrl))                                   name = 'Groq'
    else if (/mistral/i.test(baseUrl) || /mistral/i.test(model))     name = 'Mistral'
    else if (/azure/i.test(baseUrl))                                  name = 'Azure OpenAI'
    else if (/localhost:11434/i.test(baseUrl))                        name = 'Ollama'
    else if (/localhost:1234/i.test(baseUrl))                         name = 'LM Studio'
    else if (/llama/i.test(model))                                    name = 'Meta Llama'
    else if (isLocal)                                                  name = 'Local'
    return { name, model, baseUrl, isLocal }
  }

  // Default: Anthropic
  const model = savedModel || 'claude-sonnet-4-6'
  return { name: 'Anthropic', model, baseUrl: 'https://api.anthropic.com', isLocal: false }
}

// ─── Box drawing ──────────────────────────────────────────────────────────────

function boxRow(content: string, width: number, rawLen: number): string {
  const pad = Math.max(0, width - 2 - rawLen)
  return `${rgb(...BORDER)}\u2502${RESET}${content}${' '.repeat(pad)}${rgb(...BORDER)}\u2502${RESET}`
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function printStartupScreen(): void {
  // Skip in non-interactive / CI / print mode
  if (process.env.CI || !process.stdout.isTTY) return

  const p = detectProvider()
  const W = 62
  const out: string[] = []

  out.push('')

  // Gradient logo — SNOW + CODE side-by-side on each row
  const total = LOGO_SNOW.length
  for (let i = 0; i < total; i++) {
    const t = total > 1 ? i / (total - 1) : 0
    out.push(paintLine((LOGO_SNOW[i] ?? '') + (LOGO_CODE[i] ?? ''), SNOW_GRAD, t))
  }

  out.push('')

  // Tagline
  out.push(`  ${rgb(...ACCENT)}\u2726${RESET} ${rgb(...CREAM)}It's cold outside, isn't it?${RESET} ${rgb(...ACCENT)}\u2726${RESET}`)
  out.push('')

  // Provider info box
  out.push(`${rgb(...BORDER)}\u2554${'\u2550'.repeat(W - 2)}\u2557${RESET}`)

  const lbl = (k: string, v: string, c: RGB = CREAM): [string, number] => {
    const padK = k.padEnd(9)
    return [` ${DIM}${rgb(...DIMCOL)}${padK}${RESET} ${rgb(...c)}${v}${RESET}`, ` ${padK} ${v}`.length]
  }

  const provC: RGB = p.isLocal ? [130, 175, 130] : ACCENT
  let [r, l] = lbl('Provider', p.name, provC)
  out.push(boxRow(r, W, l))
  ;[r, l] = lbl('Model', p.model)
  out.push(boxRow(r, W, l))
  const ep = p.baseUrl.length > 38 ? p.baseUrl.slice(0, 35) + '...' : p.baseUrl
  ;[r, l] = lbl('Endpoint', ep)
  out.push(boxRow(r, W, l))

  out.push(`${rgb(...BORDER)}\u2560${'\u2550'.repeat(W - 2)}\u2563${RESET}`)

  const sC: RGB = p.isLocal ? [130, 175, 130] : ACCENT
  const sL = p.isLocal ? 'local' : 'cloud'
  const sRow = ` ${rgb(...sC)}\u25cf${RESET} ${DIM}${rgb(...DIMCOL)}${sL}${RESET}    ${DIM}${rgb(...DIMCOL)}Ready \u2014 type ${RESET}${rgb(...ACCENT)}/help${RESET}${DIM}${rgb(...DIMCOL)} to begin${RESET}`
  const sLen = ` \u25cf ${sL}    Ready \u2014 type /help to begin`.length
  out.push(boxRow(sRow, W, sLen))

  out.push(`${rgb(...BORDER)}\u255a${'\u2550'.repeat(W - 2)}\u255d${RESET}`)
  const _ver = MACRO.DISPLAY_VERSION ?? MACRO.VERSION ?? getCurrentVersion()
  checkForUpdateInBackground()
  const _update = getAvailableUpdate(readUpdateCache())
  out.push(`  ${DIM}${rgb(...DIMCOL)}snowcode v${_ver}${RESET}`)
  if (_update) {
    out.push(`  ${rgb(...ACCENT)}★ Update available v${_update}  →  /update${RESET}`)
  }
  out.push('')

  process.stdout.write(out.join('\n') + '\n')
}
