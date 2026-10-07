/**
 * Contrato de la API, en funciones puras.
 *
 * Todo el parseo y la validacion viven aca, sin fetch ni React, para que
 * sean testeables con node:test sin navegador.
 *
 * El precio de las órdenes viaja en CENTAVOS enteros y el dashboard en
 * DECIMALES. No es una inconsistencia: cada read model pre-calcula lo que
 * necesita, y la capa HTTP no puede hacer aritmética sobre los datos (hay un
 * test de arquitectura que lo verifica).
 */

/** Respuesta 200 de GET /api/stats. */
export interface DashboardStats {
  totalRevenue: number
  totalOrders: number
  updatedAt: string
}

/** Respuesta 201 de POST /api/orders. */
export interface CreatedOrder {
  id: string
  productName: string
  /** String a proposito: es un Decimal de Prisma y mandarlo como number
   *  reintroduce el error de punto flotante en el cliente. */
  price: string
  createdAt: string
}

/** Una fila de GET /api/orders. */
export interface OrderRow {
  id: string
  productName: string
  /** Centavos enteros. El backend no hace aritmética en el read path. */
  priceCents: number
  createdAt: string
}

export interface OrderPage {
  rows: OrderRow[]
  total: number
  /** Cursor para la página siguiente. null cuando no hay más. */
  nextCursor: string | null
}

/** Error normalizado de la API. */
export interface ApiErrorBody {
  code: string
  message: string
  details?: { field: string; message: string }[]
}

export interface ParsedStats {
  ok: boolean
  data?: DashboardStats
  /** 404 NO_STATS: todavia no hay read model. No es un error de red. */
  empty: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Valida la respuesta de /api/stats.
 *
 * No se fia de TypeScript: el dato cruza la red. Un `totalRevenue` que
 * llegue como string o ausente tiene que ser un fallo explicito, no un
 * NaN que se renderiza como "NaN" en el dashboard.
 */
export function parseStats(raw: unknown): ParsedStats {
  if (!isRecord(raw)) return { ok: false, empty: false }

  if (!isRecord(raw.data)) return { ok: false, empty: false }

  const { totalRevenue, totalOrders, updatedAt } = raw.data

  if (typeof totalRevenue !== 'number' || !Number.isFinite(totalRevenue)) {
    return { ok: false, empty: false }
  }

  if (typeof totalOrders !== 'number' || !Number.isFinite(totalOrders)) {
    return { ok: false, empty: false }
  }

  if (typeof updatedAt !== 'string') return { ok: false, empty: false }

  return {
    ok: true,
    empty: false,
    data: { totalRevenue, totalOrders, updatedAt },
  }
}

/** Identifica el 404 NO_STATS, que la API devuelve cuando aun no hay datos. */
export function isNoStatsError(raw: unknown): boolean {
  if (!isRecord(raw)) return false
  if (!isRecord(raw.error)) return false

  return raw.error.code === 'NO_STATS'
}

/** Convierte un error de la API en un mensaje que se pueda mostrar. */
export function describeApiError(raw: unknown): string {
  if (isRecord(raw) && isRecord(raw.error)) {
    const { message, details } = raw.error as Record<string, unknown>

    if (Array.isArray(details) && details.length > 0) {
      const first = details[0]
      if (isRecord(first) && typeof first.field === 'string') {
        return `${String(first.field)}: ${String(first.message)}`
      }
    }

    if (typeof message === 'string') return message
  }

  return 'error inesperado del servidor'
}

/**
 * Valida la respuesta de GET /api/orders.
 *
 * Descarta filas con forma inesperada en lugar de propagarlas: una fila rota
 * no puede romper toda la tabla, y una fila que no se puede mostrar es peor
 * que no mostrarla.
 */
export function parseOrderPage(raw: unknown): OrderPage | null {
  if (!isRecord(raw)) return null
  if (!Array.isArray(raw.data)) return null

  const meta = isRecord(raw.meta) ? raw.meta : {}
  const rows: OrderRow[] = []

  for (const entry of raw.data) {
    if (!isRecord(entry)) continue

    const { id, productName, priceCents, createdAt } = entry

    if (typeof id !== 'string' || id.length === 0) continue
    if (typeof productName !== 'string') continue
    if (typeof priceCents !== 'number' || !Number.isFinite(priceCents)) continue
    if (typeof createdAt !== 'string') continue

    rows.push({ id, productName, priceCents, createdAt })
  }

  return {
    rows,
    total: typeof meta.total === 'number' ? meta.total : rows.length,
    nextCursor: typeof meta.nextCursor === 'string' ? meta.nextCursor : null,
  }
}

// --------------------------------------------------------------
// Formulario de orden
// --------------------------------------------------------------

export interface OrderDraft {
  productName: string
  price: string
}

export interface FieldError {
  field: 'productName' | 'price'
  message: string
}

/**
 * Valida el formulario con las MISMAS reglas que el backend.
 *
 * No alcanza con validar aca: el zod del command side es el que manda,
 * pero un mensaje de error instantaneo evita un round-trip y muestra al
 * usuario el problema antes de que la API lo rechace.
 *
 * El epsilon de 1e-9 es el mismo que en el backend: sin el, 19.99 se
 * rechazaria porque 19.99 * 100 === 1998.9999999999998.
 */
export function validateOrderDraft(draft: OrderDraft): FieldError[] {
  const errors: FieldError[] = []
  const name = draft.productName.trim()

  if (name.length === 0) {
    errors.push({ field: 'productName', message: 'el nombre no puede estar vacío' })
  } else if (name.length > 255) {
    errors.push({ field: 'productName', message: 'máximo 255 caracteres' })
  }

  const rawPrice = draft.price.trim()

  if (rawPrice.length === 0) {
    errors.push({ field: 'price', message: 'el precio es obligatorio' })
    return errors
  }

  const price = Number(rawPrice)

  if (!Number.isFinite(price)) {
    errors.push({ field: 'price', message: 'tiene que ser un número' })
    return errors
  }

  if (price <= 0) {
    errors.push({ field: 'price', message: 'tiene que ser mayor que 0' })
  }

  if (Math.abs(price * 100 - Math.round(price * 100)) >= 1e-9) {
    errors.push({ field: 'price', message: 'admite máximo 2 decimales' })
  }

  return errors
}

/** Arma el body del POST. Devuelve null si el draft es invalido. */
export function buildOrderBody(draft: OrderDraft): { productName: string; price: number } | null {
  if (validateOrderDraft(draft).length > 0) return null

  return {
    productName: draft.productName.trim(),
    price: Number(draft.price.trim()),
  }
}

// --------------------------------------------------------------
// Presentacion
// --------------------------------------------------------------

const CURRENCY = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/**
 * Formatea un importe YA EN CENTAVOS.
 *
 * La division por 100 ocurre aca, en el cliente, y no en el backend: la capa
 * HTTP no puede hacer aritmetica sobre los datos del read model. El
 * `Intl.NumberFormat` con 2 decimales ya redondea, asi que no hay drift.
 */
export function formatCents(cents: number): string {
  return CURRENCY.format(cents / 100)
}

/**
 * Formatea el importe de las estadisticas, que ya viene en decimales.
 *
 * Es pre-calculado por la proyeccion con $round, asi que aca solo se
 * formatea.
 */
export function formatRevenue(value: number): string {
  return CURRENCY.format(value)
}

/** "hace 3 s" a partir del timestamp ISO del read model. */
export function formatAge(isoDate: string, now: Date = new Date()): string {
  const then = new Date(isoDate).getTime()

  if (!Number.isFinite(then)) return 'desconocido'

  const seconds = Math.max(0, Math.round((now.getTime() - then) / 1000))

  if (seconds < 5) return 'hace instantes'
  if (seconds < 60) return `hace ${seconds} s`

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `hace ${minutes} min`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `hace ${hours} h`

  return `hace ${Math.floor(hours / 24)} d`
}

/** Fecha corta para la tabla: "7 oct 14:30". */
export function formatTimestamp(isoDate: string): string {
  const date = new Date(isoDate)

  if (Number.isNaN(date.getTime())) return '—'

  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}