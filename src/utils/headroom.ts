/**
 * headroom — automatic input compression for LLM context.
 *
 * When enabled via /config > Headroom, wraps the API messages with headroom-ai
 * compression before every API call. Falls back to native compression if the
 * headroom-ai package is not available.
 *
 * https://github.com/chopratejas/headroom
 */

import type { MessageParam } from '@anthropic-ai/sdk/resources/messages.mjs'
import { getGlobalConfig, saveGlobalConfig } from './config.js'

// ─── Settings ────────────────────────────────────────────────────────────────

export function isHeadroomEnabled(): boolean {
  const cfg = getGlobalConfig() as { headroomEnabled?: boolean }
  return cfg.headroomEnabled === true
}

export function setHeadroomEnabled(enabled: boolean): void {
  saveGlobalConfig(cfg => ({ ...cfg, headroomEnabled: enabled }))
}

// ─── Native fallback ─────────────────────────────────────────────────────────

const MAX_CHARS = 50_000
const MAX_ARRAY_ITEMS = 100
const MAX_LINES = 300
const KEEP_LINES = 100

function compressJSON(v: unknown, depth = 0): unknown {
  if (depth > 6) return '[object]'
  if (Array.isArray(v)) {
    const items = v.slice(0, MAX_ARRAY_ITEMS).map(x => compressJSON(x, depth + 1))
    if (v.length > MAX_ARRAY_ITEMS)
      (items as unknown[]).push(`[… ${v.length - MAX_ARRAY_ITEMS} more items omitted]`)
    return items
  }
  if (v !== null && typeof v === 'object') {
    const r: Record<string, unknown> = {}
    for (const [k, val] of Object.entries(v as Record<string, unknown>))
      r[k] = compressJSON(val, depth + 1)
    return r
  }
  return v
}

function nativeCompress(text: string): string {
  if (text.length <= MAX_CHARS) return text
  const t = text.trim()
  if (t.startsWith('{') || t.startsWith('[')) {
    try {
      const str = JSON.stringify(compressJSON(JSON.parse(t)))
      if (str.length <= MAX_CHARS) return str
      return str.slice(0, MAX_CHARS) + `\n[headroom: ${str.length - MAX_CHARS} chars omitted]`
    } catch {}
  }
  const lines = text.split('\n')
  if (lines.length > MAX_LINES) {
    const head = lines.slice(0, KEEP_LINES)
    const tail = lines.slice(-KEEP_LINES)
    const omitted = lines.length - KEEP_LINES * 2
    text = [...head, `[headroom: ${omitted} lines omitted]`, ...tail].join('\n')
  }
  if (text.length > MAX_CHARS)
    text = text.slice(0, MAX_CHARS) + `\n[headroom: ${text.length - MAX_CHARS} chars omitted]`
  return text
}

// ─── headroom-ai library integration ─────────────────────────────────────────

type HeadroomCompress = (opts: {
  messages: MessageParam[]
  model?: string
  optimize?: boolean
}) => Promise<{ messages: MessageParam[]; tokens_saved?: number; compression_ratio?: number }>

let _headroomCompress: HeadroomCompress | null | 'unavailable' = null

async function getHeadroomCompress(): Promise<HeadroomCompress | null> {
  if (_headroomCompress === 'unavailable') return null
  if (_headroomCompress !== null) return _headroomCompress
  try {
    // Dynamic import — headroom-ai is an optional peer dep
    const mod = await import('headroom-ai' as string) as {
      compress?: HeadroomCompress
      default?: { compress?: HeadroomCompress }
    }
    const fn = mod.compress ?? mod.default?.compress ?? null
    _headroomCompress = fn ?? 'unavailable'
    return fn
  } catch {
    _headroomCompress = 'unavailable'
    return null
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

type ContentBlock = { type: string; [k: string]: unknown }

function nativeCompressMessages(messages: MessageParam[]): MessageParam[] {
  return messages.map(msg => {
    if (msg.role !== 'user' || !Array.isArray(msg.content)) return msg
    const content = (msg.content as ContentBlock[]).map(block => {
      if (block.type !== 'tool_result') return block
      if (typeof block.content === 'string')
        return { ...block, content: nativeCompress(block.content) }
      if (Array.isArray(block.content))
        return {
          ...block,
          content: (block.content as ContentBlock[]).map(item =>
            item.type === 'text' && typeof item.text === 'string'
              ? { ...item, text: nativeCompress(item.text) }
              : item,
          ),
        }
      return block
    })
    const changed = content.some((b, i) => b !== (msg.content as ContentBlock[])[i])
    return changed ? { ...msg, content } : msg
  })
}

/**
 * Apply headroom compression to API messages.
 * Uses headroom-ai library if available, native fallback otherwise.
 * No-ops when headroom is disabled in config.
 */
export async function applyHeadroom(messages: MessageParam[]): Promise<MessageParam[]> {
  if (!isHeadroomEnabled()) return messages

  // Try headroom-ai library first
  const compress = await getHeadroomCompress()
  if (compress) {
    try {
      const result = await compress({ messages, optimize: true })
      return result.messages
    } catch {
      // Library errored — fall through to native
    }
  }

  // Native fallback
  return nativeCompressMessages(messages)
}
