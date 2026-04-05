#!/usr/bin/env node

/**
 * Test script for Vertex AI, Codex, and GLM 4.7 providers
 */

import { spawn } from 'node:child_process'

const tests = [
  {
    name: 'Vertex AI',
    env: {
      CLAUDE_CODE_USE_OPENAI: '1',
      OPENAI_BASE_URL: 'https://aiplatform.googleapis.com/v1',
      OPENAI_MODEL: 'gemini-2.5-flash-lite',
      OPENAI_API_KEY: process.env.VERTEX_API_KEY || '',
    },
  },
  {
    name: 'Codex',
    env: {
      CLAUDE_CODE_USE_OPENAI: '1',
      OPENAI_MODEL: 'codexplan',
      CODEX_API_KEY: process.env.CODEX_API_KEY || '',
    },
  },
  {
    name: 'GLM 4.7',
    env: {
      CLAUDE_CODE_USE_OPENAI: '1',
      OPENAI_BASE_URL: 'https://api.together.xyz/v1',
      OPENAI_MODEL: 'glm-4.7-7b',
      OPENAI_API_KEY: process.env.TOGETHER_API_KEY || '',
    },
  },
]

async function runTest(test: { name: string; env: Record<string, string> }) {
  console.log(`\n🧪 Testing ${test.name}...`)

  // Check if API key is set
  const hasKey = Object.values(test.env).some((v) => v && v.length > 0)
  if (!hasKey) {
    console.log(`⚠️  Skipping ${test.name} - no API key configured`)
    console.log(`   Set ${Object.keys(test.env).join(', ')} environment variables`)
    return false
  }

  return new Promise<boolean>((resolve) => {
    const child = spawn('node', ['dist/cli.mjs', '--print', 'Say "Hello from provider!"'], {
      env: { ...process.env, ...test.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (data) => {
      stdout += data.toString()
    })

    child.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    child.on('close', (code) => {
      if (code === 0) {
        console.log(`✅ ${test.name} - Success`)
        console.log(`   Response: ${stdout.trim()}`)
        resolve(true)
      } else {
        console.log(`❌ ${test.name} - Failed (exit code: ${code})`)
        if (stderr) {
          console.log(`   Error: ${stderr.trim()}`)
        }
        resolve(false)
      }
    })

    child.on('error', (err) => {
      console.log(`❌ ${test.name} - Error: ${err.message}`)
      resolve(false)
    })
  })
}

async function main() {
  console.log('🚀 Testing SnowCode Providers\n')

  let passed = 0
  let failed = 0

  for (const test of tests) {
    const result = await runTest(test)
    if (result === true) {
      passed++
    } else if (result === false) {
      failed++
    }
  }

  console.log('\n📊 Results:')
  console.log(`   Passed: ${passed}`)
  console.log(`   Failed: ${failed}`)
  console.log(`   Skipped: ${tests.length - passed - failed}`)

  if (passed > 0) {
    console.log('\n✨ At least one provider is working!')
    process.exit(0)
  } else {
    console.log('\n⚠️  No providers configured. See VERTEX_CODEX_GLM.md for setup instructions.')
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('Error running tests:', err)
  process.exit(1)
})
