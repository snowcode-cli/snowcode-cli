import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createOpenAIShimClient } from './openaiShim.js'

type FetchType = typeof globalThis.fetch

const originalEnv = {
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  SNOWCODE_CONFIG_DIR: process.env.SNOWCODE_CONFIG_DIR,
}

const originalFetch = globalThis.fetch
const tempDirs: string[] = []

type OpenAIShimClient = {
  beta: {
    messages: {
      countTokens: (
        params: Record<string, unknown>,
      ) => Promise<{ input_tokens: number }>
      create: (
        params: Record<string, unknown>,
        options?: Record<string, unknown>,
      ) => Promise<unknown> & {
        withResponse: () => Promise<{ data: AsyncIterable<Record<string, unknown>> }>
      }
    }
  }
}

function makeSseResponse(lines: string[]): Response {
  const encoder = new TextEncoder()
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const line of lines) {
          controller.enqueue(encoder.encode(line))
        }
        controller.close()
      },
    }),
    {
      headers: {
        'Content-Type': 'text/event-stream',
      },
    },
  )
}

function makeStreamChunks(chunks: unknown[]): string[] {
  return [
    ...chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`),
    'data: [DONE]\n\n',
  ]
}

beforeEach(() => {
  process.env.OPENAI_BASE_URL = 'http://example.test/v1'
  process.env.OPENAI_API_KEY = 'test-key'
})

test('provides countTokens compatibility for shim clients', async () => {
  const client = createOpenAIShimClient({}) as OpenAIShimClient

  const result = await client.beta.messages.countTokens({
    model: 'gpt-4o',
    system: 'system prompt',
    messages: [{ role: 'user', content: 'hello world' }],
    tools: [
      {
        name: 'Echo',
        description: 'Echo input',
        input_schema: {
          type: 'object',
          properties: {
            text: { type: 'string' },
          },
        },
      },
    ],
  })

  expect(result.input_tokens).toBeGreaterThan(0)
})

afterEach(() => {
  process.env.OPENAI_BASE_URL = originalEnv.OPENAI_BASE_URL
  process.env.OPENAI_API_KEY = originalEnv.OPENAI_API_KEY
  process.env.SNOWCODE_CONFIG_DIR = originalEnv.SNOWCODE_CONFIG_DIR
  globalThis.fetch = originalFetch
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function createTempAccountsConfig(payload: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), 'snowcode-openai-shim-'))
  tempDirs.push(dir)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'accounts.json'), JSON.stringify(payload), 'utf8')
  writeFileSync(
    join(dir, 'settings.json'),
    JSON.stringify(
      {
        antigravityClientId: 'test-antigravity-client-id',
        antigravityClientSecret: 'test-antigravity-client-secret',
      },
      null,
      2,
    ),
    'utf8',
  )
  return dir
}

test('preserves usage from final OpenAI stream chunk with empty choices', async () => {
  globalThis.fetch = (async (_input, init) => {
    const url = typeof _input === 'string' ? _input : _input.url
    expect(url).toBe('http://example.test/v1/chat/completions')

    const body = JSON.parse(String(init?.body))
    expect(body.stream).toBe(true)
    expect(body.stream_options).toEqual({ include_usage: true })

    const chunks = makeStreamChunks([
      {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        model: 'fake-model',
        choices: [
          {
            index: 0,
            delta: { role: 'assistant', content: 'hello world' },
            finish_reason: null,
          },
        ],
      },
      {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        model: 'fake-model',
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: 'stop',
          },
        ],
      },
      {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        model: 'fake-model',
        choices: [],
        usage: {
          prompt_tokens: 123,
          completion_tokens: 45,
          total_tokens: 168,
        },
      },
    ])

    return makeSseResponse(chunks)
  }) as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient

  const result = await client.beta.messages
    .create({
      model: 'fake-model',
      system: 'test system',
      messages: [{ role: 'user', content: 'hello' }],
      max_tokens: 64,
      stream: true,
    })
    .withResponse()

  const events: Array<Record<string, unknown>> = []
  for await (const event of result.data) {
    events.push(event)
  }

  const usageEvent = events.find(
    event => event.type === 'message_delta' && typeof event.usage === 'object' && event.usage !== null,
  ) as { usage?: { input_tokens?: number; output_tokens?: number } } | undefined

  expect(usageEvent).toBeDefined()
  expect(usageEvent?.usage?.input_tokens).toBe(123)
  expect(usageEvent?.usage?.output_tokens).toBe(45)
})

test('maps Anthropic output_config effort into OpenAI reasoning_effort', async () => {
  globalThis.fetch = (async (_input, init) => {
    const url = typeof _input === 'string' ? _input : _input.url
    expect(url).toBe('http://example.test/v1/chat/completions')

    const body = JSON.parse(String(init?.body))
    expect(body.model).toBe('gpt-5.4')
    expect(body.reasoning_effort).toBe('medium')

    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'gpt-5.4',
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'done',
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 12,
          completion_tokens: 4,
          total_tokens: 16,
        },
      }),
      {
        headers: {
          'Content-Type': 'application/json',
        },
      },
    )
  }) as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient

  await client.beta.messages.create({
    model: 'openai:gpt-5.4',
    system: 'test system',
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 64,
    stream: false,
    output_config: { effort: 'medium' },
  })
})

test('strips unsupported uri format from OpenAI tool schemas', async () => {
  let requestBody: Record<string, unknown> | undefined

  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))

    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'gpt-5.4',
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'done',
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 12,
          completion_tokens: 4,
          total_tokens: 16,
        },
      }),
      {
        headers: {
          'Content-Type': 'application/json',
        },
      },
    )
  }) as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient

  await client.beta.messages.create({
    model: 'openai:gpt-5.4',
    system: 'test system',
    messages: [{ role: 'user', content: 'hello' }],
    tools: [
      {
        name: 'WebFetch',
        description: 'Fetch a URL',
        input_schema: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              format: 'uri',
            },
          },
        },
      },
    ],
    max_tokens: 64,
    stream: false,
  })

  const urlSchema = (
    requestBody?.tools as Array<{
      function?: {
        parameters?: {
          properties?: {
            url?: Record<string, unknown>
          }
        }
      }
    }>
  )?.[0]?.function?.parameters?.properties?.url

  expect(urlSchema?.format).toBeUndefined()
})

test('preserves Gemini tool call extra_content in follow-up requests', async () => {
  let requestBody: Record<string, unknown> | undefined

  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))

    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'google/gemini-3.1-pro-preview',
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'done',
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 12,
          completion_tokens: 4,
          total_tokens: 16,
        },
      }),
      {
        headers: {
          'Content-Type': 'application/json',
        },
      },
    )
  }) as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient

  await client.beta.messages.create({
    model: 'google/gemini-3.1-pro-preview',
    system: 'test system',
    messages: [
      { role: 'user', content: 'Use Bash' },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'call_1',
            name: 'Bash',
            input: { command: 'pwd' },
            extra_content: {
              google: {
                thought_signature: 'sig-123',
              },
            },
          },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'call_1',
            content: 'D:\\repo',
          },
        ],
      },
    ],
    max_tokens: 64,
    stream: false,
  })

  const assistantWithToolCall = (requestBody?.messages as Array<Record<string, unknown>>).find(
    message => Array.isArray(message.tool_calls),
  ) as { tool_calls?: Array<Record<string, unknown>> } | undefined

  expect(assistantWithToolCall?.tool_calls?.[0]).toMatchObject({
    id: 'call_1',
    type: 'function',
    function: {
      name: 'Bash',
      arguments: JSON.stringify({ command: 'pwd' }),
    },
    extra_content: {
      google: {
        thought_signature: 'sig-123',
      },
    },
  })
})

test('preserves Gemini tool call extra_content from streaming chunks', async () => {
  globalThis.fetch = (async (_input, _init) => {
    const chunks = makeStreamChunks([
      {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        model: 'google/gemini-3.1-pro-preview',
        choices: [
          {
            index: 0,
            delta: {
              role: 'assistant',
              tool_calls: [
                {
                  index: 0,
                  id: 'function-call-1',
                  type: 'function',
                  extra_content: {
                    google: {
                      thought_signature: 'sig-stream',
                    },
                  },
                  function: {
                    name: 'Bash',
                    arguments: '{"command":"pwd"}',
                  },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      },
      {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        model: 'google/gemini-3.1-pro-preview',
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: 'tool_calls',
          },
        ],
      },
    ])

    return makeSseResponse(chunks)
  }) as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient

  const result = await client.beta.messages
    .create({
      model: 'google/gemini-3.1-pro-preview',
      system: 'test system',
      messages: [{ role: 'user', content: 'Use Bash' }],
      max_tokens: 64,
      stream: true,
    })
    .withResponse()

  const events: Array<Record<string, unknown>> = []
  for await (const event of result.data) {
    events.push(event)
  }

  const toolStart = events.find(
    event =>
      event.type === 'content_block_start' &&
      typeof event.content_block === 'object' &&
      event.content_block !== null &&
      (event.content_block as Record<string, unknown>).type === 'tool_use',
  ) as { content_block?: Record<string, unknown> } | undefined

  expect(toolStart?.content_block).toMatchObject({
    type: 'tool_use',
    id: 'function-call-1',
    name: 'Bash',
    extra_content: {
      google: {
        thought_signature: 'sig-stream',
      },
    },
  })
})

test('refreshes google_oauth account for antigravity requests before sending Authorization header', async () => {
  const configDir = createTempAccountsConfig({
    version: 1,
    accounts: [
      {
        id: 'google-1',
        type: 'google_oauth',
        label: 'Google test',
        enabled: true,
        refreshToken: 'refresh-token-123',
        addedAt: '2026-04-02T00:00:00.000Z',
      },
    ],
  })
  process.env.SNOWCODE_CONFIG_DIR = configDir
  process.env.OPENAI_API_KEY = ''
  process.env.OPENAI_BASE_URL = 'https://daily-cloudcode-pa.googleapis.com'

  const fetchCalls: Array<{ url: string; init?: RequestInit }> = []
  globalThis.fetch = (async (input, init) => {
    const url = typeof input === 'string' ? input : input.url
    fetchCalls.push({ url, init })

    if (url === 'https://oauth2.googleapis.com/token') {
      return new Response(JSON.stringify({ access_token: 'google-access-token' }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (url === 'https://daily-cloudcode-pa.googleapis.com/v1internal:loadCodeAssist') {
      return new Response(
        JSON.stringify({ cloudaicompanionProject: { id: 'managed-project-1' } }),
        { headers: { 'Content-Type': 'application/json' } },
      )
    }

    return new Response(
      'data: {"candidates":[{"content":{"parts":[{"text":"ok"}],"role":"model"},"index":0,"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":1,"candidatesTokenCount":1,"totalTokenCount":2}}\n\n',
      {
        headers: { 'Content-Type': 'text/event-stream' },
      },
    )
  }) as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  await client.beta.messages.create({
    model: 'antigravity:claude-sonnet',
    system: 'test system',
    messages: [{ role: 'user', content: 'hello' }],
    tools: [
      {
        name: 'number_tool',
        description: 'Test numeric schema handling',
        input_schema: {
          type: 'object',
          properties: {
            value: {
              type: 'number',
              exclusiveMinimum: 0,
            },
          },
          required: ['value'],
        },
      },
    ],
    max_tokens: 64,
    stream: false,
  })

  expect(fetchCalls[0]?.url).toBe('https://oauth2.googleapis.com/token')
  expect(fetchCalls[1]?.url).toBe(
    'https://daily-cloudcode-pa.googleapis.com/v1internal:loadCodeAssist',
  )
  expect(fetchCalls[2]?.url).toBe(
    'https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse',
  )
  expect(
    (fetchCalls[2]?.init?.headers as Record<string, string> | undefined)?.Authorization,
  ).toBe('Bearer google-access-token')
  const antigravityBody = JSON.parse(String(fetchCalls[2]?.init?.body)) as {
    request?: {
      metadata?: unknown
      tools?: Array<{
        functionDeclarations?: Array<{
          parameters?: {
            properties?: {
              value?: Record<string, unknown>
            }
          }
        }>
      }>
    }
  }
  expect(antigravityBody.request?.metadata).toBeUndefined()
  expect(
    antigravityBody.request?.tools?.[0]?.functionDeclarations?.[0]?.parameters?.properties?.value
      ?.exclusiveMinimum,
  ).toBeUndefined()
})

test('uses antigravity default base URL when OPENAI_BASE_URL is unset', async () => {
  const configDir = createTempAccountsConfig({
    version: 1,
    accounts: [
      {
        id: 'google-1',
        type: 'google_oauth',
        label: 'Google test',
        enabled: true,
        refreshToken: 'refresh-token-123',
        addedAt: '2026-04-02T00:00:00.000Z',
      },
    ],
  })
  process.env.SNOWCODE_CONFIG_DIR = configDir
  delete process.env.OPENAI_BASE_URL
  process.env.OPENAI_API_KEY = ''

  const fetchCalls: Array<{ url: string; init?: RequestInit }> = []
  globalThis.fetch = (async (input, init) => {
    const url = typeof input === 'string' ? input : input.url
    fetchCalls.push({ url, init })

    if (url === 'https://oauth2.googleapis.com/token') {
      return new Response(JSON.stringify({ access_token: 'google-access-token' }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (url === 'https://daily-cloudcode-pa.googleapis.com/v1internal:loadCodeAssist') {
      return new Response(
        JSON.stringify({ cloudaicompanionProject: { id: 'managed-project-1' } }),
        { headers: { 'Content-Type': 'application/json' } },
      )
    }

    return new Response(
      'data: {"candidates":[{"content":{"parts":[{"text":"ok"}],"role":"model"},"index":0,"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":1,"candidatesTokenCount":1,"totalTokenCount":2}}\n\n',
      {
        headers: { 'Content-Type': 'text/event-stream' },
      },
    )
  }) as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  await client.beta.messages.create({
    model: 'antigravity:claude-sonnet-4-6',
    system: 'test system',
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 64,
    stream: false,
  })

  expect(fetchCalls[2]?.url).toBe(
    'https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse',
  )
})

test('uses stored account projectId for legacy antigravity accounts before falling back to default project', async () => {
  const configDir = createTempAccountsConfig({
    version: 1,
    accounts: [
      {
        id: 'google-legacy-1',
        type: 'google_oauth',
        label: 'Google legacy test',
        enabled: true,
        refreshToken: 'refresh-token-legacy',
        projectId: 'user-project-123',
        addedAt: '2026-04-02T00:00:00.000Z',
      },
    ],
  })
  process.env.SNOWCODE_CONFIG_DIR = configDir
  delete process.env.OPENAI_BASE_URL
  process.env.OPENAI_API_KEY = ''

  const fetchCalls: Array<{ url: string; init?: RequestInit }> = []
  globalThis.fetch = (async (input, init) => {
    const url = typeof input === 'string' ? input : input.url
    fetchCalls.push({ url, init })

    if (url === 'https://oauth2.googleapis.com/token') {
      return new Response(JSON.stringify({ access_token: 'google-access-token' }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (url === 'https://daily-cloudcode-pa.googleapis.com/v1internal:loadCodeAssist') {
      return new Response(
        JSON.stringify({ cloudaicompanionProject: { id: 'managed-project-1' } }),
        { headers: { 'Content-Type': 'application/json' } },
      )
    }

    return new Response(
      'data: {"candidates":[{"content":{"parts":[{"text":"ok"}],"role":"model"},"index":0,"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":1,"candidatesTokenCount":1,"totalTokenCount":2}}\n\n',
      {
        headers: { 'Content-Type': 'text/event-stream' },
      },
    )
  }) as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  await client.beta.messages.create({
    model: 'antigravity:claude-sonnet-4-6',
    system: 'test system',
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 64,
    stream: false,
  })

  expect(fetchCalls[1]?.url).toBe(
    'https://daily-cloudcode-pa.googleapis.com/v1internal:loadCodeAssist',
  )
  expect(JSON.parse(String(fetchCalls[1]?.init?.body))).toEqual({
    metadata: {
      ideType: 'ANTIGRAVITY',
      platform: 'WINDOWS',
      pluginType: 'GEMINI',
      duetProject: 'user-project-123',
    },
  })
  expect(JSON.parse(String(fetchCalls[2]?.init?.body))).toMatchObject({
    project: 'managed-project-1',
  })
})

test('prefers the most recent enabled google_oauth account for antigravity requests', async () => {
  const configDir = createTempAccountsConfig({
    version: 1,
    accounts: [
      {
        id: 'google-older',
        type: 'google_oauth',
        label: 'Google older',
        enabled: true,
        refreshToken: 'refresh-token-older',
        addedAt: '2026-04-02T00:00:00.000Z',
      },
      {
        id: 'google-newer',
        type: 'google_oauth',
        label: 'Google newer',
        enabled: true,
        refreshToken: 'refresh-token-newer|user-project-456',
        addedAt: '2026-04-02T01:00:00.000Z',
      },
    ],
  })
  process.env.SNOWCODE_CONFIG_DIR = configDir
  delete process.env.OPENAI_BASE_URL
  process.env.OPENAI_API_KEY = ''

  const fetchCalls: Array<{ url: string; init?: RequestInit }> = []
  globalThis.fetch = (async (input, init) => {
    const url = typeof input === 'string' ? input : input.url
    fetchCalls.push({ url, init })

    if (url === 'https://oauth2.googleapis.com/token') {
      const body = String(init?.body)
      expect(body).toContain('refresh_token=refresh-token-newer')
      return new Response(JSON.stringify({ access_token: 'google-access-token' }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (url === 'https://daily-cloudcode-pa.googleapis.com/v1internal:loadCodeAssist') {
      return new Response(
        JSON.stringify({ cloudaicompanionProject: { id: 'managed-project-2' } }),
        { headers: { 'Content-Type': 'application/json' } },
      )
    }

    return new Response(
      'data: {"candidates":[{"content":{"parts":[{"text":"ok"}],"role":"model"},"index":0,"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":1,"candidatesTokenCount":1,"totalTokenCount":2}}\n\n',
      {
        headers: { 'Content-Type': 'text/event-stream' },
      },
    )
  }) as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  await client.beta.messages.create({
    model: 'antigravity:claude-sonnet-4-6',
    system: 'test system',
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 64,
    stream: false,
  })

  expect(JSON.parse(String(fetchCalls[2]?.init?.body))).toMatchObject({
    project: 'managed-project-2',
  })
})

test('fails clearly when antigravity oauth account has no resolved project id', async () => {
  const configDir = createTempAccountsConfig({
    version: 1,
    accounts: [
      {
        id: 'google-missing-project',
        type: 'google_oauth',
        label: 'Google missing project',
        enabled: true,
        refreshToken: 'refresh-token-no-project',
        addedAt: '2026-04-02T01:00:00.000Z',
      },
    ],
  })
  process.env.SNOWCODE_CONFIG_DIR = configDir
  delete process.env.OPENAI_BASE_URL
  process.env.OPENAI_API_KEY = ''

  globalThis.fetch = (async (input, _init) => {
    const url = typeof input === 'string' ? input : input.url

    if (url === 'https://oauth2.googleapis.com/token') {
      return new Response(JSON.stringify({ access_token: 'google-access-token' }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (url === 'https://daily-cloudcode-pa.googleapis.com/v1internal:loadCodeAssist') {
      return new Response(JSON.stringify({}), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    throw new Error(`unexpected fetch: ${url}`)
  }) as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  await expect(
    client.beta.messages.create({
      model: 'antigravity:claude-sonnet-4-6',
      system: 'test system',
      messages: [{ role: 'user', content: 'hello' }],
      max_tokens: 64,
      stream: false,
    }),
  ).rejects.toThrow(
    'Antigravity account is missing a resolved project ID. Re-run /auth with the Google account you want to use.',
  )
})
