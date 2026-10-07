import type { ApiErrorBody, CreatedOrder, DashboardStats, OrderPage } from './contract'
import { describeApiError, isNoStatsError, parseOrderPage, parseStats } from './contract'

/**
 * Rutas relativas a proposito: el browser las pide a su propio origen y
 * el proxy de Vite (o nginx en produccion) las reenvia al backend. Asi no
 * hay CORS ni URLs absolutas que cambien entre entornos.
 */
const STATS_URL = '/api/stats'
const ORDERS_URL = '/api/orders'

export interface StatsResult {
  stats: DashboardStats | null
  /** El read model todavia no existe (404 NO_STATS). No es un error. */
  empty: boolean
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(message: string, status: number, code: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

export async function fetchStats(signal?: AbortSignal): Promise<StatsResult> {
  const response = await fetch(STATS_URL, {
    signal,
    headers: { accept: 'application/json' },
  })

  const body: unknown = await response.json().catch(() => null)

  if (response.status === 404 && isNoStatsError(body)) {
    return { stats: null, empty: true }
  }

  if (!response.ok) {
    throw new ApiError(describeApiError(body), response.status, readCode(body))
  }

  const parsed = parseStats(body)

  if (!parsed.ok || !parsed.data) {
    throw new ApiError('respuesta con formato inesperado', response.status, 'BAD_SHAPE')
  }

  return { stats: parsed.data, empty: false }
}

export async function fetchOrders(
  options?: { cursor?: string | null; limit?: number },
  signal?: AbortSignal,
): Promise<OrderPage | null> {
  const params = new URLSearchParams()

  if (options?.limit !== undefined) params.set('limit', String(options.limit))
  if (options?.cursor) params.set('cursor', options.cursor)

  const query = params.toString()
  const response = await fetch(`${ORDERS_URL}${query ? `?${query}` : ''}`, {
    signal,
    headers: { accept: 'application/json' },
  })

  const body: unknown = await response.json().catch(() => null)

  if (!response.ok) {
    throw new ApiError(describeApiError(body), response.status, readCode(body))
  }

  return parseOrderPage(body)
}

export async function createOrder(
  input: { productName: string; price: number },
  signal?: AbortSignal,
): Promise<CreatedOrder> {
  const response = await fetch(ORDERS_URL, {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(input),
  })

  const body: unknown = await response.json().catch(() => null)

  if (!response.ok) {
    throw new ApiError(describeApiError(body), response.status, readCode(body))
  }

  return extractOrder(body)
}

export async function pauseProjection(): Promise<void> {
  await postDemo('/api/_demo/pause')
}

export async function resumeProjection(): Promise<void> {
  await postDemo('/api/_demo/resume')
}

async function postDemo(url: string): Promise<void> {
  const response = await fetch(url, { method: 'POST' })

  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null)
    throw new ApiError(describeApiError(body), response.status, readCode(body))
  }
}

function readCode(body: unknown): string {
  if (typeof body === 'object' && body !== null && 'error' in body) {
    const { error } = body as { error: ApiErrorBody }
    if (typeof error?.code === 'string') return error.code
  }

  return 'UNKNOWN'
}

function extractOrder(body: unknown): CreatedOrder {
  if (typeof body !== 'object' || body === null || !('data' in body)) {
    throw new ApiError('respuesta con formato inesperado', 200, 'BAD_SHAPE')
  }

  const { data } = body as { data: Record<string, unknown> }
  const { id, productName, price, createdAt } = data

  if (
    typeof id !== 'string' ||
    typeof productName !== 'string' ||
    typeof price !== 'string' ||
    typeof createdAt !== 'string'
  ) {
    throw new ApiError('respuesta con formato inesperado', 200, 'BAD_SHAPE')
  }

  return { id, productName, price, createdAt }
}