import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { resetRipgrepForTests, ripGrep } from './ripgrep.js'

let tempDir: string
const originalUseBuiltin = process.env.USE_BUILTIN_RIPGREP

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'snowcode-rg-fallback-'))
  mkdirSync(join(tempDir, 'src'), { recursive: true })
  writeFileSync(join(tempDir, 'src', 'alpha.ts'), 'const alpha = "needle";\n')
  writeFileSync(join(tempDir, 'src', 'beta.js'), 'const beta = "other";\n')
  process.env.USE_BUILTIN_RIPGREP = '1'
  resetRipgrepForTests()
})

afterEach(() => {
  process.env.USE_BUILTIN_RIPGREP = originalUseBuiltin
  resetRipgrepForTests()
  rmSync(tempDir, { recursive: true, force: true })
})

test('falls back to JS file listing when ripgrep binary is unavailable', async () => {
  const results = await ripGrep(
    ['--files', '--hidden', '--glob', '*.ts'],
    tempDir,
    AbortSignal.timeout(5000),
  )

  expect(results).toHaveLength(1)
  expect(results[0]).toEndWith(join('src', 'alpha.ts'))
})

test('falls back to JS content search when ripgrep binary is unavailable', async () => {
  const results = await ripGrep(
    ['-n', '--no-heading', '-F', '-e', 'needle'],
    tempDir,
    AbortSignal.timeout(5000),
  )

  expect(results).toHaveLength(1)
  expect(results[0]).toContain('alpha.ts:1:const alpha = "needle";')
})
