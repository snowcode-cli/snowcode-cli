import { resolveAntigravityAuthForModel } from './providerConfig.js'
import { getAntigravityVersionState } from './antigravityVersion.js'
import { appendHttpLog } from './httpLog.js'
import {
  type VertexShimParams,
  convertSystemPrompt,
  convertMessagesToVertex,
  convertToolsToVertex,
} from './vertexShim.js'

const ANTIGRAVITY_METADATA = {
  ideType: 'ANTIGRAVITY',
  platform: 'PLATFORM_UNSPECIFIED',
  pluginType: 'GEMINI',
} as const

type AntigravityErrorPayload = {
  error?: {
    code?: number
    message?: string
    status?: string
    details?: Array<{
      ['@type']?: string
      reason?: string
      domain?: string
      metadata?: {
        model?: string
      }
    }>
  }
}

function getAntigravityFriendlyErrorMessage(errorBody: string): string | undefined {
  try {
    const parsed = JSON.parse(errorBody) as AntigravityErrorPayload
    const error = parsed.error
    const reason = error?.details?.find(detail => detail?.reason)?.reason
    const model =
      error?.details?.find(detail => detail?.metadata?.model)?.metadata?.model

    if (
      error?.code === 503 &&
      (reason === 'MODEL_CAPACITY_EXHAUSTED' ||
        error.status === 'UNAVAILABLE' ||
        error.message?.includes('No capacity available'))
    ) {
      return model
        ? `${model} is temporarily at capacity. Try again in a moment or switch to another model.`
        : 'This Antigravity model is temporarily at capacity. Try again in a moment or switch to another model.'
    }
  } catch {
  }

  return undefined
}

export async function performAntigravityRequest({
  request,
  params,
  defaultHeaders,
  signal,
}: VertexShimParams): Promise<Response> {
  const vertexMessages = convertMessagesToVertex(
    params.messages as Array<Record<string, unknown>>,
    undefined,
  )
  const systemPrompt = convertSystemPrompt(params.system)

  const requestBody: Record<string, unknown> = {
    contents: vertexMessages,
    generationConfig: {
      maxOutputTokens: params.max_tokens,
      temperature: params.temperature ?? 0.7,
    },
  }

  if (systemPrompt) {
    requestBody.systemInstruction = {
      parts: [{ text: systemPrompt }],
    }
  }

  if (params.tools && params.tools.length > 0) {
    const converted = convertToolsToVertex(
      params.tools as Array<{
        name: string
        description?: string
        input_schema?: Record<string, unknown>
      }>,
    )
    if (converted.functionDeclarations.length > 0) {
      requestBody.tools = [converted]
    }
  }

  const auth = await resolveAntigravityAuthForModel(request.requestedModel)
  const resolvedProjectId = auth?.managedProjectId ?? auth?.projectId
  if (!resolvedProjectId) {
    throw new Error(
      'Antigravity account is missing a resolved project ID. Re-run /auth with the Google account you want to use.',
    )
  }

  const antigravityVersion = getAntigravityVersionState()

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
    'User-Agent': `antigravity/${antigravityVersion.version} windows/amd64`,
    'X-Goog-Api-Client': 'google-cloud-sdk vscode_cloudshelleditor/0.1',
    'Client-Metadata': JSON.stringify(ANTIGRAVITY_METADATA),
  }

  for (const [key, value] of Object.entries(defaultHeaders ?? {})) {
    const normalizedKey = key.toLowerCase()
    if (
      value &&
      normalizedKey !== 'user-agent' &&
      normalizedKey !== 'x-app' &&
      normalizedKey !== 'x-claude-code-session-id'
    ) {
      headers[key] = value
    }
  }

  if (auth?.accessToken) {
    headers.Authorization = `Bearer ${auth.accessToken}`
  }

  const body: Record<string, unknown> = {
    project: resolvedProjectId,
    model: request.resolvedModel,
    request: {
      ...requestBody,
      sessionId: `snowcode-${Date.now().toString(36)}`,
    },
    userAgent: 'antigravity',
    requestId: `agent-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`,
  }
  const antigravityUrl = `${(auth?.baseUrl ?? request.baseUrl).replace(/\/+$/, '')}/v1internal:streamGenerateContent?alt=sse`
  const serializedBody = JSON.stringify(body)
  const serializedHeaders = Object.entries(headers)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n')

  const response = await fetch(antigravityUrl, {
    method: 'POST',
    headers,
    body: serializedBody,
    signal,
  })

  if (!response.ok) {
    const errorBody = await response.text().catch(() => 'unknown error')
    appendHttpLog(
      'streamGenerateContent error',
      `POST ${antigravityUrl}\n${serializedHeaders}\n\n${serializedBody}`,
      `status=${response.status}\n${errorBody}`,
    )
    const friendlyMessage = getAntigravityFriendlyErrorMessage(errorBody)
    throw new Error(
      friendlyMessage ?? `Antigravity API error ${response.status}: ${errorBody}`,
    )
  }

  appendHttpLog(
    'streamGenerateContent success',
    `POST ${antigravityUrl}\n${serializedHeaders}\n\n${serializedBody}`,
    `status=${response.status}\n<streaming response body omitted>`,
  )

  return response
}
