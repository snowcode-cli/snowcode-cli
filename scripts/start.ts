#!/usr/bin/env node

/**
 * snowcode launcher with .env support
 * Loads environment variables from .env file before starting the CLI
 */

import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import dotenv from 'dotenv'
import dotenvExpand from 'dotenv-expand'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Load .env file silently if it exists
const envPath = resolve(process.cwd(), '.env')

if (existsSync(envPath)) {
  const envConfig = dotenv.config({ path: envPath })
  dotenvExpand.expand(envConfig)
}

// Build the project
const buildProcess = spawn('bun', ['run', 'build'], {
  stdio: 'inherit',
  cwd: resolve(__dirname, '..'),
})

await new Promise<void>((resolve, reject) => {
  buildProcess.on('close', (code) => {
    if (code === 0) {
      resolve()
    } else {
      reject(new Error(`Build failed with exit code ${code}`))
    }
  })
})

// Start snowcode
const cliPath = resolve(__dirname, '..', 'dist', 'cli.mjs')
const cliArgs = process.argv.slice(2)

console.log('\n🚀 Starting snowcode...\n')

const cliProcess = spawn(process.execPath, [cliPath, ...cliArgs], {
  stdio: 'inherit',
  env: { ...process.env, SNOWCODE_FORCE_TTY: '1' },
  cwd: process.cwd(),
})

cliProcess.on('close', (code, signal) => {
  // On Windows, Ctrl+C exits with code 1 — treat as clean exit
  if (signal === 'SIGINT' || signal === 'SIGTERM' || code === 1) {
    process.exit(0)
  }
  process.exit(code ?? 0)
})

process.on('SIGINT', () => {
  process.exit(0)
})

cliProcess.on('error', (err) => {
  console.error('Error starting snowcode:', err)
  process.exit(1)
})
