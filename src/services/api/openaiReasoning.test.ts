import { afterEach, beforeEach, expect, test } from 'bun:test'

import { createOpenAIShimClient } from './openaiShim.js'

type FetchType = typeof globalThis.fetch

const originalEnv = {
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
}

const originalFetch = globalThis.fetch

type OpenAIShimClient = {
  beta: {
    messages: {
      create: (params: Record<string, unknown>) => Promise<unknown>
    }
  }
}

beforeEach(() => {
  process.env.OPENAI_BASE_URL = 'http://example.test/v1'
  process.env.OPENAI_API_KEY = 'test-key'
})

afterEach(() => {
  process.env.OPENAI_BASE_URL = originalEnv.OPENAI_BASE_URL
  process.env.OPENAI_API_KEY = originalEnv.OPENAI_API_KEY
  globalThis.fetch = originalFetch
})

test('maps Anthropic effort onto OpenAI reasoning_effort for provider-prefixed models', async () => {
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
