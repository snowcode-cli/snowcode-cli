import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  compareVersions,
  getAvailableUpdate,
  getCurrentVersion,
  readUpdateCache,
  refreshUpdateCache,
} from './updateCheck.js'

const tempDirs: string[] = []
const originalFetch = globalThis.fetch
const originalConfigDir = process.env.SNOWCODE_CONFIG_DIR
const packageVersion = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
) as { version: string }

afterEach(() => {
  globalThis.fetch = originalFetch
  if (originalConfigDir === undefined) {
    delete process.env.SNOWCODE_CONFIG_DIR
  } else {
    process.env.SNOWCODE_CONFIG_DIR = originalConfigDir
  }

  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function createTempConfigDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'snowcode-update-'))
  tempDirs.push(dir)
  process.env.SNOWCODE_CONFIG_DIR = dir
  return dir
}

test('refreshUpdateCache fetches latest npm version and persists the cache', async () => {
  const dir = createTempConfigDir()

  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ version: '9.9.9' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })) as typeof fetch

  const cache = await refreshUpdateCache({ force: true, timeoutMs: 1000 })

  expect(cache?.latestVersion).toBe('9.9.9')
  expect(getAvailableUpdate(cache)).toBe('9.9.9')

  const persisted = JSON.parse(
    readFileSync(join(dir, 'update-check.json'), 'utf8'),
  ) as { latestVersion?: string }
  expect(persisted.latestVersion).toBe('9.9.9')
})

test('refreshUpdateCache reuses a fresh cache without refetching', async () => {
  createTempConfigDir()

  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ version: '1.2.3' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })) as typeof fetch

  const first = await refreshUpdateCache({ force: true, timeoutMs: 1000 })
  expect(first?.latestVersion).toBe('1.2.3')

  let fetchCalls = 0
  globalThis.fetch = (async () => {
    fetchCalls += 1
    return new Response(JSON.stringify({ version: '9.9.9' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as typeof fetch

  const second = await refreshUpdateCache()

  expect(second?.latestVersion).toBe('1.2.3')
  expect(fetchCalls).toBe(0)
  expect(readUpdateCache()?.latestVersion).toBe('1.2.3')
})

test('getCurrentVersion falls back to package.json version outside the bundled runtime', () => {
  expect(compareVersions(getCurrentVersion(), packageVersion.version)).toBe(0)
})

test('refreshUpdateCache refetches when a fresh cache is behind the installed version', async () => {
  const dir = createTempConfigDir()
  const behindVersion =
    compareVersions(packageVersion.version, '0.9.0') > 0 ? '0.9.0' : '0.0.1'

  writeFileSync(
    join(dir, 'update-check.json'),
    JSON.stringify({
      latestVersion: behindVersion,
      checkedAt: Date.now(),
    }),
  )

  let fetchCalls = 0
  globalThis.fetch = (async () => {
    fetchCalls += 1
    return new Response(JSON.stringify({ version: packageVersion.version }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as typeof fetch

  const cache = await refreshUpdateCache()

  expect(fetchCalls).toBe(1)
  expect(cache?.latestVersion).toBe(packageVersion.version)
  expect(getAvailableUpdate(cache)).toBeNull()
  expect(readUpdateCache()?.latestVersion).toBe(packageVersion.version)
})
