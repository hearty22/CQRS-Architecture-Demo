import { env } from '../config/env.js'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const SEVERITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

const COLOR: Record<LogLevel, string> = {
  debug: '\x1b[90m',
  info: '\x1b[36m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
}
const RESET = '\x1b[0m'

const useColor = process.stdout.isTTY === true
const threshold = SEVERITY[env.LOG_LEVEL]

export interface Logger {
  debug(...args: unknown[]): void
  info(...args: unknown[]): void
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
  child(scope: string): Logger
}

function emit(level: LogLevel, scope: string | undefined, args: unknown[]): void {
  if (SEVERITY[level] < threshold) return

  const timestamp = new Date().toISOString()
  const tag = level.toUpperCase().padEnd(5)
  const head = useColor ? `${COLOR[level]}${tag}${RESET}` : tag
  const where = scope ? ` [${scope}]` : ''
  const line = `${timestamp} ${head}${where}`

  // warn y error van a stderr para no ensuciar stdout.
  if (level === 'error' || level === 'warn') {
    console.error(line, ...args)
  } else {
    console.log(line, ...args)
  }
}

function makeLogger(scope?: string): Logger {
  return {
    debug: (...args) => emit('debug', scope, args),
    info: (...args) => emit('info', scope, args),
    warn: (...args) => emit('warn', scope, args),
    error: (...args) => emit('error', scope, args),
    child: (childScope) => makeLogger(scope ? `${scope}:${childScope}` : childScope),
  }
}

export const logger = makeLogger()
