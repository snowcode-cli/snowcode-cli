/**
 * Google Vertex AI API shim for Claude Code.
 *
 * Translates Anthropic SDK calls into Vertex AI streamGenerateContent format.
 *
 * Environment variables:
 *   CLAUDE_CODE_USE_OPENAI=1          — enable provider
 *   OPENAI_BASE_URL=https://aiplatform.googleapis.com/v1
 *   OPENAI_MODEL=gemini-2.5-flash-lite
 *   VERTEX_API_KEY=your-vertex-api-key   (preferred)
 *   OPENAI_API_KEY=your-vertex-api-key   (fallback, for compatibility)
 */

import type {
  AnthropicUsage,
  AnthropicStreamEvent,
  ShimCreateParams,
} from './codexShim.js'
import type {
  ResolvedCodexCredentials,
  ResolvedProviderRequest,
} from './providerConfig.js'
import { resolveApiKeyFromAccounts } from './providerConfig.js'
import { appendHttpLog } from './httpLog.js'

type VertexPart = {
  text?: string
  functionCall?: {
    name: string
    args: Record<string, unknown>
  }
  functionResponse?: {
    name: string
    response: Record<string, unknown>
  }
}

type VertexContent = {
  role: 'user' | 'model' | 'function'
  parts: VertexPart[]
}

type VertexFunctionDeclaration = {
  name: string
  description: string
  parameters?: {
    type: string
    properties: Record<string, unknown>
    required?: string[]
  }
}

type VertexTool = {
  functionDeclarations: VertexFunctionDeclaration[]
}

type VertexSseChunk = {
  response?: {
    candidates: Array<{
      content: VertexContent
      finishReason?: string
      index: number
    }>
    usageMetadata?: {
      promptTokenCount: number
      candidatesTokenCount: number
      totalTokenCount: number
    }
  }
  candidates: Array<{
    content: VertexContent
    finishReason?: string
    index: number
  }>
  usageMetadata?: {
    promptTokenCount: number
    candidatesTokenCount: number
    totalTokenCount: number
  }
}

function makeUsage(usage?: {
  promptTokenCount?: number
  candidatesTokenCount?: number
}): AnthropicUsage {
  return {
    input_tokens: usage?.promptTokenCount ?? 0,
    output_tokens: usage?.candidatesTokenCount ?? 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  }
}

function makeMessageId(): string {
  return `msg_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
}

export function convertSystemPrompt(system: unknown): string {
  if (!system) return ''
  if (typeof system === 'string') return system
  if (Array.isArray(system)) {
    return system
      .map((block: { type?: string; text?: string }) =>
        block.type === 'text' ? block.text ?? '' : '',
      )
      .join('\n\n')
  }
  return String(system)
}

function convertContentBlocksToParts(
  content: unknown,
): VertexPart[] {
  const parts: VertexPart[] = []

  if (typeof content === 'string') {
    parts.push({ text: content })
    return parts
  }

  if (!Array.isArray(content)) {
    parts.push({ text: String(content ?? '') })
    return parts
  }

  for (const block of content) {
    switch (block.type) {
      case 'text':
        parts.push({ text: block.text ?? '' })
        break
      case 'image':
        // Vertex AI supports inline data
        const src = block.source
        if (src?.type === 'base64') {
          parts.push({
            text: `[IMAGE: data:${src.media_type};base64,${src.data.substring(0, 50)}...]`,
          })
        }
        break
      case 'tool_use':
        parts.push({
          functionCall: {
            name: block.name,
            args: block.input ?? {},
          },
        })
        break
      case 'tool_result':
        parts.push({
          functionResponse: {
            name: block.tool_use_id,
            response: { result: block.content },
          },
        })
        break
      case 'thinking':
        if (block.thinking) {
          parts.push({ text: `<thinking>${block.thinking}</thinking>` })
        }
        break
      default:
        if (block.text) {
          parts.push({ text: block.text })
        }
    }
  }

  return parts
}

function convertAnthropicMessageToVertex(
  msg: { role?: string; content?: unknown },
): VertexContent {
  const role = msg.role === 'assistant' ? 'model' : 'user'
  const parts = convertContentBlocksToParts(msg.content)
  return { role, parts }
}

export function convertMessagesToVertex(
  messages: Array<Record<string, unknown>>,
  system: unknown,
): VertexContent[] {
  const result: VertexContent[] = []

  // System prompt as first user message
  const sysText = convertSystemPrompt(system)
  if (sysText) {
    result.push({
      role: 'user',
      parts: [{ text: `System: ${sysText}` }],
    })
  }

  // Convert each Anthropic message to Vertex format
  for (const msg of messages) {
    const inner = (msg.message ?? msg) as { role?: string; content?: unknown }
    const vertexMsg = convertAnthropicMessageToVertex(inner)
    result.push(vertexMsg)
  }

  return result
}

/**
 * Vertex AI only supports a subset of JSON Schema.
 * Strip fields that cause 400 errors: $schema, propertyNames, $defs, $ref,
 * additionalProperties (object form), unevaluatedProperties, if/then/else, etc.
 */
function sanitizeSchemaForVertex(schema: unknown): unknown {
  if (schema === null || typeof schema !== 'object') return schema
  if (Array.isArray(schema)) return schema.map(sanitizeSchemaForVertex)

  const UNSUPPORTED = new Set([
    '$schema', '$defs', '$ref', '$id', '$comment',
    'propertyNames', 'unevaluatedProperties', 'unevaluatedItems',
    'if', 'then', 'else', 'not', 'allOf', 'anyOf', 'oneOf',
    'contains', 'minContains', 'maxContains',
    'dependentRequired', 'dependentSchemas',
    'exclusiveMinimum', 'exclusiveMaximum',
    'contentEncoding', 'contentMediaType', 'contentSchema',
    'examples', 'default', 'deprecated', 'readOnly', 'writeOnly',
  ])

  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
    if (UNSUPPORTED.has(k)) continue
    // additionalProperties as object is unsupported; boolean is fine
    if (k === 'additionalProperties' && v !== null && typeof v === 'object') continue
    out[k] = sanitizeSchemaForVertex(v)
  }

  if (out.type === 'object') {
    const properties =
      out.properties && typeof out.properties === 'object' && !Array.isArray(out.properties)
        ? (out.properties as Record<string, unknown>)
        : {}

    out.properties = properties

    if (Array.isArray(out.required)) {
      const filtered = out.required.filter(
        (key): key is string =>
          typeof key === 'string' && Object.prototype.hasOwnProperty.call(properties, key),
      )
      if (filtered.length > 0) {
        out.required = filtered
      } else {
        delete out.required
      }
    }
  }

  return out
}

export function convertToolsToVertex(
  tools: Array<{
    name: string
    description?: string
    input_schema?: Record<string, unknown>
  }>,
): VertexTool {
  const declarations: VertexFunctionDeclaration[] = tools
    .filter((t) => t.name)
    .map((t) => ({
      name: t.name,
      description: t.description || '',
      parameters: sanitizeSchemaForVertex(t.input_schema || {
        type: 'object',
        properties: {},
      }) as Record<string, unknown>,
    }))

  return { functionDeclarations: declarations }
}

async function* parseVertexSSE(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): AsyncGenerator<AnthropicStreamEvent> {
  const decoder = new TextDecoder()
  let buffer = ''
  let messageId = makeMessageId()

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue

      const data = line.slice(6)
      if (data === '[DONE]') {
        yield { type: 'message_stop' }
        return
      }

      try {
        const chunk = JSON.parse(data) as VertexSseChunk
        const responseChunk = chunk.response ?? chunk
        const candidate = responseChunk.candidates?.[0]

        if (!candidate) continue

        const content = candidate.content

        // Handle function calls
        for (const part of content.parts) {
          if (part.functionCall) {
            yield {
              type: 'content_block_start',
              content_block: {
                type: 'tool_use',
                id: `toolu_${Date.now()}_${Math.random().toString(36).slice(2)}`,
                name: part.functionCall.name,
                input: part.functionCall.args,
              },
              index: 0,
            }
            yield {
              type: 'content_block_delta',
              delta: {
                type: 'input_json_delta',
                partial_json: JSON.stringify(part.functionCall.args),
              },
              index: 0,
            }
            yield {
              type: 'content_block_stop',
              index: 0,
            }
          }
        }

        // Handle text content
        const textParts = content.parts.filter((p) => p.text)
        for (const part of textParts) {
          if (part.text) {
            yield {
              type: 'content_block_delta',
              delta: { type: 'text_delta', text: part.text },
              index: 0,
            }
          }
        }

        // Handle usage
        if (responseChunk.usageMetadata) {
          yield {
            type: 'message_delta',
            usage: makeUsage(responseChunk.usageMetadata),
            delta: { stop_reason: candidate.finishReason || 'end_turn' },
          }
        }
      } catch (e) {
        // Skip invalid JSON
        continue
      }
    }
  }
}

export interface VertexShimParams {
  request: ResolvedProviderRequest
  credentials?: ResolvedCodexCredentials
  params: ShimCreateParams
  defaultHeaders?: Record<string, string>
  signal?: AbortSignal
}

export async function performVertexRequest({
  request,
  params,
  defaultHeaders,
  signal,
}: VertexShimParams): Promise<Response> {
  const vertexMessages = convertMessagesToVertex(
    params.messages as Array<Record<string, unknown>>,
    params.system,
  )

  const body: Record<string, unknown> = {
    contents: vertexMessages,
    generationConfig: {
      maxOutputTokens: params.max_tokens,
      temperature: params.temperature ?? 0.7,
    },
  }

  // Add tools if present
  if (params.tools && params.tools.length > 0) {
    const converted = convertToolsToVertex(
      params.tools as Array<{
        name: string
        description?: string
        input_schema?: Record<string, unknown>
      }>,
    )
    if (converted.functionDeclarations.length > 0) {
      body.tools = [converted]
    }
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...defaultHeaders,
  }

  // Use API key for Vertex AI
  // Priority: accounts.json > VERTEX_API_KEY env > OPENAI_API_KEY env
  const apiKey =
    resolveApiKeyFromAccounts(request.requestedModel) ??
    process.env.VERTEX_API_KEY ??
    process.env.OPENAI_API_KEY ??
    ''

  // Build URL with model name
  const model = request.resolvedModel
  const baseUrl = request.baseUrl
  const url = `${baseUrl}/publishers/google/models/${model}:streamGenerateContent?key=${apiKey}`

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
  })

  if (!response.ok) {
    const errorBody = await response.text().catch(() => 'unknown error')
    appendHttpLog(
      `${request.requestedModel} error`,
      `POST ${url}\n${Object.entries(headers)
        .map(([key, value]) => `${key}: ${value}`)
        .join('\n')}\n\n${JSON.stringify(body)}`,
      `status=${response.status}\n${errorBody}`,
    )
    throw new Error(`Vertex AI API error ${response.status}: ${errorBody}`)
  }

  appendHttpLog(
    `${request.requestedModel} success`,
    `POST ${url}\n${Object.entries(headers)
      .map(([key, value]) => `${key}: ${value}`)
      .join('\n')}\n\n${JSON.stringify(body)}`,
    `status=${response.status}\n<streaming response body omitted>`,
  )

  return response
}

export function vertexStreamToAnthropic(
  response: Response,
): AsyncGenerator<AnthropicStreamEvent> {
  const reader = response.body?.getReader()
  if (!reader) {
    throw new Error('No response body')
  }

  return parseVertexSSE(reader)
}

export async function collectVertexCompletedResponse(
  response: Response,
): Promise<{ message: Record<string, unknown>; usage: AnthropicUsage }> {
  const reader = response.body?.getReader()
  if (!reader) {
    throw new Error('No response body')
  }

  const decoder = new TextDecoder()
  let buffer = ''
  const messageId = makeMessageId()
  let contentBlock: Record<string, unknown> | null = null
  let textAccumulator = ''
  let usage: AnthropicUsage = {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue

      const data = line.slice(6)
      if (data === '[DONE]') break

      try {
        const chunk = JSON.parse(data) as VertexSseChunk
        const responseChunk = chunk.response ?? chunk
        const candidate = responseChunk.candidates?.[0]

        if (responseChunk.usageMetadata) {
          usage = makeUsage(responseChunk.usageMetadata)
        }

        if (!candidate) continue

        const content = candidate.content

        // Collect function calls
        for (const part of content.parts) {
          if (part.functionCall) {
            contentBlock = {
              type: 'tool_use',
              id: `toolu_${Date.now()}_${Math.random().toString(36).slice(2)}`,
              name: part.functionCall.name,
              input: part.functionCall.args,
            }
          }
        }

        // Collect text
        const textParts = content.parts.filter((p) => p.text)
        for (const part of textParts) {
          if (part.text) {
            textAccumulator += part.text
          }
        }
      } catch {
        continue
      }
    }
  }

  const messageContent = contentBlock
    ? [contentBlock]
    : textAccumulator
    ? [{ type: 'text', text: textAccumulator }]
    : []

  return {
    message: {
      id: messageId,
      role: 'assistant',
      content: messageContent,
      model: 'vertex-model',
      stop_reason: 'end_turn',
      usage,
    },
    usage,
  }
}
