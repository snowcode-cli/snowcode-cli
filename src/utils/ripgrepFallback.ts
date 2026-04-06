import { lstat, readdir, readFile, realpath, stat } from 'fs/promises'
import { basename, dirname, extname, join, relative, resolve } from 'path'
import picomatch from 'picomatch'
import { logForDebugging } from './debug.js'

const VCS_DIRECTORIES = new Set([
  '.git',
  '.svn',
  '.hg',
  '.bzr',
  '.jj',
  '.sl',
])

const TYPE_EXTENSIONS: Record<string, string[]> = {
  c: ['c', 'h'],
  cpp: ['cc', 'cpp', 'cxx', 'hpp', 'hh', 'hxx'],
  csharp: ['cs'],
  css: ['css', 'scss', 'sass', 'less'],
  go: ['go'],
  html: ['html', 'htm'],
  java: ['java'],
  js: ['js', 'mjs', 'cjs'],
  json: ['json', 'jsonc', 'jsonl'],
  jsx: ['jsx'],
  md: ['md', 'markdown'],
  php: ['php'],
  py: ['py'],
  rb: ['rb'],
  rs: ['rs'],
  rust: ['rs'],
  sh: ['sh', 'bash', 'zsh'],
  sql: ['sql'],
  ts: ['ts', 'mts', 'cts'],
  tsx: ['tsx'],
  vue: ['vue'],
  xml: ['xml'],
  yaml: ['yaml', 'yml'],
}

type ParsedRipgrepArgs = {
  filesMode: boolean
  hidden: boolean
  followSymlinks: boolean
  noIgnore: boolean
  noIgnoreVcs: boolean
  fixedStrings: boolean
  ignoreCase: boolean
  filesWithMatches: boolean
  countOnly: boolean
  showLineNumbers: boolean
  multiline: boolean
  dotAll: boolean
  pattern?: string
  globPatterns: string[]
  type?: string
  maxColumns?: number
  maxDepth?: number
  maxMatchesPerFile?: number
  contextBefore: number
  contextAfter: number
  sortModified: boolean
}

type CompiledGlobs = {
  include: Array<(path: string) => boolean>
  exclude: Array<(path: string) => boolean>
}

function createAbortError(): Error {
  const error = new Error('The operation was aborted')
  error.name = 'AbortError'
  return error
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw createAbortError()
  }
}

function normalizePosixPath(filePath: string): string {
  return filePath.replace(/\\/g, '/')
}

function isHiddenPath(relativePath: string): boolean {
  return normalizePosixPath(relativePath)
    .split('/')
    .some(segment => segment.startsWith('.') && segment.length > 1)
}

function matchesGlob(pattern: string, relativePath: string): boolean {
  const normalizedPattern = normalizePosixPath(pattern)
  const normalizedPath = normalizePosixPath(relativePath)

  if (normalizedPattern.endsWith('/')) {
    const dirPattern = normalizedPattern.slice(0, -1)
    return (
      normalizedPath === dirPattern ||
      normalizedPath.startsWith(`${dirPattern}/`)
    )
  }

  return picomatch(normalizedPattern, {
    dot: true,
    basename: !normalizedPattern.includes('/'),
  })(normalizedPath)
}

function compileGlobs(globPatterns: string[]): CompiledGlobs {
  const include: Array<(path: string) => boolean> = []
  const exclude: Array<(path: string) => boolean> = []

  for (const pattern of globPatterns) {
    if (!pattern) continue
    if (pattern.startsWith('!')) {
      const rawPattern = pattern.slice(1)
      exclude.push(relativePath => matchesGlob(rawPattern, relativePath))
    } else {
      include.push(relativePath => matchesGlob(pattern, relativePath))
    }
  }

  return { include, exclude }
}

function parseRipgrepArgs(args: string[]): ParsedRipgrepArgs {
  const parsed: ParsedRipgrepArgs = {
    filesMode: false,
    hidden: false,
    followSymlinks: false,
    noIgnore: false,
    noIgnoreVcs: false,
    fixedStrings: false,
    ignoreCase: false,
    filesWithMatches: false,
    countOnly: false,
    showLineNumbers: false,
    multiline: false,
    dotAll: false,
    globPatterns: [],
    contextBefore: 0,
    contextAfter: 0,
    sortModified: false,
  }

  for (let index = 0; index < args.length; index++) {
    const arg = args[index]

    switch (arg) {
      case '--files':
        parsed.filesMode = true
        break
      case '--hidden':
        parsed.hidden = true
        break
      case '--follow':
        parsed.followSymlinks = true
        break
      case '--no-ignore':
        parsed.noIgnore = true
        break
      case '--no-ignore-vcs':
        parsed.noIgnoreVcs = true
        break
      case '-F':
        parsed.fixedStrings = true
        break
      case '-i':
        parsed.ignoreCase = true
        break
      case '-l':
        parsed.filesWithMatches = true
        break
      case '-c':
        parsed.countOnly = true
        break
      case '-n':
        parsed.showLineNumbers = true
        break
      case '--no-heading':
        break
      case '-U':
        parsed.multiline = true
        break
      case '--multiline-dotall':
        parsed.dotAll = true
        break
      case '--sort=modified':
        parsed.sortModified = true
        break
      case '--sort':
        if (args[index + 1] === 'modified') {
          parsed.sortModified = true
          index++
        }
        break
      case '--max-columns':
        parsed.maxColumns = Number(args[++index] ?? 0) || undefined
        break
      case '--max-depth':
        parsed.maxDepth = Number(args[++index] ?? 0) || 0
        break
      case '-m':
        parsed.maxMatchesPerFile = Number(args[++index] ?? 0) || undefined
        break
      case '-B':
        parsed.contextBefore = Number(args[++index] ?? 0) || 0
        break
      case '-A':
        parsed.contextAfter = Number(args[++index] ?? 0) || 0
        break
      case '-C': {
        const context = Number(args[++index] ?? 0) || 0
        parsed.contextBefore = context
        parsed.contextAfter = context
        break
      }
      case '--glob':
        parsed.globPatterns.push(args[++index] ?? '')
        break
      case '--type':
        parsed.type = (args[++index] ?? '').toLowerCase()
        break
      case '-e':
        parsed.pattern = args[++index] ?? ''
        break
      default:
        if (!arg.startsWith('-') && parsed.pattern === undefined) {
          parsed.pattern = arg
        }
        break
    }
  }

  return parsed
}

function matchesTypeFilter(filePath: string, type: string | undefined): boolean {
  if (!type) return true

  const fileExt = extname(filePath).replace(/^\./, '').toLowerCase()
  if (!fileExt) return false

  const allowed = TYPE_EXTENSIONS[type] ?? [type]
  return allowed.includes(fileExt)
}

function shouldIncludePath(
  relativePath: string,
  parsed: ParsedRipgrepArgs,
  globs: CompiledGlobs,
): boolean {
  const normalized = normalizePosixPath(relativePath)

  if (!parsed.hidden && isHiddenPath(normalized)) {
    return false
  }

  const segments = normalized.split('/')
  if (!parsed.noIgnoreVcs && !parsed.noIgnore) {
    for (const segment of segments.slice(0, -1)) {
      if (VCS_DIRECTORIES.has(segment)) {
        return false
      }
    }
  }

  if (globs.exclude.some(matcher => matcher(normalized))) {
    return false
  }

  if (globs.include.length > 0) {
    return globs.include.some(matcher => matcher(normalized))
  }

  return true
}

async function collectFiles(
  target: string,
  parsed: ParsedRipgrepArgs,
  signal: AbortSignal,
): Promise<string[]> {
  throwIfAborted(signal)

  const absoluteTarget = resolve(target)
  const absoluteFiles: string[] = []
  const visitedDirs = new Set<string>()
  const globs = compileGlobs(parsed.globPatterns)
  const targetLstat = await lstat(absoluteTarget)
  const targetStats =
    targetLstat.isSymbolicLink() && parsed.followSymlinks
      ? await stat(absoluteTarget)
      : targetLstat
  const rootDir = targetStats.isDirectory()
    ? absoluteTarget
    : dirname(absoluteTarget)

  async function walk(currentPath: string, depth: number): Promise<void> {
    throwIfAborted(signal)

    const currentLstat = await lstat(currentPath)
    const currentStats =
      currentLstat.isSymbolicLink() && parsed.followSymlinks
        ? await stat(currentPath)
        : currentLstat

    if (currentStats.isDirectory()) {
      if (parsed.maxDepth !== undefined && depth > parsed.maxDepth) {
        return
      }

      const relativeDir =
        currentPath === rootDir
          ? ''
          : normalizePosixPath(relative(rootDir, currentPath))

      if (relativeDir) {
        if (!parsed.hidden && isHiddenPath(relativeDir)) {
          return
        }
        if (
          !parsed.noIgnoreVcs &&
          !parsed.noIgnore &&
          VCS_DIRECTORIES.has(basename(currentPath))
        ) {
          return
        }
        if (globs.exclude.some(matcher => matcher(relativeDir))) {
          return
        }
      }

      const dirKey =
        currentStats.dev !== undefined && currentStats.ino !== undefined
          ? `${currentStats.dev}:${currentStats.ino}`
          : await realpath(currentPath)

      if (visitedDirs.has(dirKey)) {
        return
      }
      visitedDirs.add(dirKey)

      const entries = await readdir(currentPath, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isSymbolicLink() && !parsed.followSymlinks) {
          continue
        }
        await walk(join(currentPath, entry.name), depth + 1)
      }
      return
    }

    if (!currentStats.isFile()) {
      return
    }

    const relativeFile =
      currentPath === absoluteTarget && !targetStats.isDirectory()
        ? basename(currentPath)
        : normalizePosixPath(relative(rootDir, currentPath))

    if (!matchesTypeFilter(currentPath, parsed.type)) {
      return
    }
    if (!shouldIncludePath(relativeFile, parsed, globs)) {
      return
    }

    absoluteFiles.push(currentPath)
  }

  await walk(absoluteTarget, 0)

  if (parsed.sortModified) {
    const withTimes = await Promise.all(
      absoluteFiles.map(async filePath => ({
        filePath,
        mtimeMs: (await stat(filePath)).mtimeMs,
      })),
    )
    withTimes.sort((a, b) => a.mtimeMs - b.mtimeMs)
    return withTimes.map(entry => entry.filePath)
  }

  return absoluteFiles.sort((a, b) => a.localeCompare(b))
}

function truncateForOutput(text: string, maxColumns?: number): string {
  if (!maxColumns || maxColumns <= 0 || text.length <= maxColumns) {
    return text
  }
  return text.slice(0, maxColumns)
}

function createTextMatcher(parsed: ParsedRipgrepArgs): {
  matchesLine: (line: string) => boolean
} {
  const rawPattern = parsed.pattern ?? ''

  if (parsed.fixedStrings) {
    const needle = parsed.ignoreCase ? rawPattern.toLowerCase() : rawPattern
    return {
      matchesLine: line => {
        const haystack = parsed.ignoreCase ? line.toLowerCase() : line
        return haystack.includes(needle)
      },
    }
  }

  const flags = `${parsed.ignoreCase ? 'i' : ''}${parsed.multiline ? 'm' : ''}${parsed.dotAll ? 's' : ''}`
  const regex = new RegExp(rawPattern, flags)
  return {
    matchesLine: line => regex.test(line),
  }
}

function buildContentLines(
  filePath: string,
  content: string,
  parsed: ParsedRipgrepArgs,
): string[] {
  const matcher = createTextMatcher(parsed)
  const lines = content.split(/\r?\n/)
  const matchIndexes: number[] = []

  for (let index = 0; index < lines.length; index++) {
    if (matcher.matchesLine(lines[index] ?? '')) {
      matchIndexes.push(index)
      if (
        parsed.maxMatchesPerFile !== undefined &&
        matchIndexes.length >= parsed.maxMatchesPerFile
      ) {
        break
      }
    }
  }

  if (matchIndexes.length === 0) {
    return []
  }

  if (parsed.filesWithMatches) {
    return [filePath]
  }

  if (parsed.countOnly) {
    return [`${filePath}:${matchIndexes.length}`]
  }

  const included = new Set<number>()
  for (const matchIndex of matchIndexes) {
    const start = Math.max(0, matchIndex - parsed.contextBefore)
    const end = Math.min(lines.length - 1, matchIndex + parsed.contextAfter)
    for (let lineIndex = start; lineIndex <= end; lineIndex++) {
      included.add(lineIndex)
    }
  }

  return Array.from(included)
    .sort((a, b) => a - b)
    .map(lineIndex => {
      const lineNumber = lineIndex + 1
      const line = truncateForOutput(lines[lineIndex] ?? '', parsed.maxColumns)
      return parsed.showLineNumbers
        ? `${filePath}:${lineNumber}:${line}`
        : `${filePath}:${line}`
    })
}

export async function fallbackRipGrep(
  args: string[],
  target: string,
  abortSignal: AbortSignal,
): Promise<string[]> {
  const parsed = parseRipgrepArgs(args)
  const files = await collectFiles(target, parsed, abortSignal)

  if (parsed.filesMode) {
    return files
  }

  if (!parsed.pattern) {
    return []
  }

  const results: string[] = []
  for (const filePath of files) {
    throwIfAborted(abortSignal)
    try {
      const content = await readFile(filePath, 'utf8')
      results.push(...buildContentLines(filePath, content, parsed))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logForDebugging(`Fallback ripgrep skipped ${filePath}: ${message}`)
    }
  }

  return results
}

export async function fallbackRipGrepStream(
  args: string[],
  target: string,
  abortSignal: AbortSignal,
  onLines: (lines: string[]) => void,
): Promise<void> {
  const lines = await fallbackRipGrep(args, target, abortSignal)
  for (let index = 0; index < lines.length; index += 64) {
    throwIfAborted(abortSignal)
    onLines(lines.slice(index, index + 64))
  }
}

export async function fallbackRipGrepFileCount(
  args: string[],
  target: string,
  abortSignal: AbortSignal,
): Promise<number> {
  const parsed = parseRipgrepArgs(args)
  const files = await collectFiles(target, parsed, abortSignal)
  return files.length
}
