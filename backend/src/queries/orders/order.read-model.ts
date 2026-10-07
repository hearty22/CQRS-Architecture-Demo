import { Order } from './order.model.js'

/** Lo que ve el cliente de cada fila. */
export interface OrderView {
  id: string
  productName: string
  /**
   * Importe en CENTAVOS enteros.
   *
   * Viaja entero a propósito. El backend devuelve el dato crudo y el cliente
   * lo formatea: convertir a decimal en la respuesta sería aritmética en el
   * read path, que es justamente lo que la regla de arquitectura prohíbe.
   */
  priceCents: number
  createdAt: string
}

export interface OrderPage {
  items: OrderView[]
  /** Cursor para pedir la página siguiente. null cuando no hay más. */
  nextCursor: string | null
}

export const DEFAULT_LIMIT = 20
export const MAX_LIMIT = 100

interface OrderDoc {
  _id: string
  productName: string
  priceCents: number
  createdAt: Date
}

/**
 * Cursor opaco de paginación.
 *
 * Codifica `createdAt` + `_id` en base64url.
 *
 * Lleva el desempate porque `createdAt` solo no alcanza: varias órdenes
 * pueden compartir milisegundo, y sin el `_id` la paginación puede repetir
 * o saltar una fila.
 *
 * Se serializa como JSON y no con un separador tipo `fecha|id`: parsear con
 * `lastIndexOf` parece funcionar pero parte mal si el id contiene el mismo
 * caracter. Con JSON no hay ambigüedad.
 */
function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(JSON.stringify([createdAt.toISOString(), id]), 'utf8').toString(
    'base64url',
  )
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8')
    const parsed: unknown = JSON.parse(raw)

    if (!Array.isArray(parsed) || parsed.length !== 2) return null

    const [isoDate, id] = parsed as [unknown, unknown]

    if (typeof isoDate !== 'string' || typeof id !== 'string' || id.length === 0) {
      return null
    }

    const createdAt = new Date(isoDate)
    if (Number.isNaN(createdAt.getTime())) return null

    return { createdAt, id }
  } catch {
    // Un cursor corrupto no es un error 500: es un cursor inválido.
    return null
  }
}

/**
 * Lista órdenes en orden descendente por fecha, paginadas por cursor.
 *
 * Paginación por keyset, NO por skip. `skip` obliga a MongoDB a contar y
 * descartar los N documentos anteriores en cada página, así que la página 50
 * cuesta 50 veces más que la primera. Con el cursor, el índice
 * `{ createdAt, _id }` hace un seek directo.
 *
 * CERO aritmética sobre los datos: `priceCents` se devuelve tal cual. La
 * conversión a decimales ocurre en la capa HTTP.
 */
export async function listOrders(options?: {
  limit?: number
  cursor?: string | null
}): Promise<OrderPage> {
  const limit = clampLimit(options?.limit)
  const cursor = options?.cursor ? decodeCursor(options.cursor) : null

  // Descendente, así que "página siguiente" son los documentos MÁS viejos:
  // el filtro tiene que quedar por debajo del cursor.
  const filter = cursor
    ? {
        $or: [
          { createdAt: { $lt: cursor.createdAt } },
          { createdAt: cursor.createdAt, _id: { $lt: cursor.id } },
        ],
      }
    : {}

  const docs = await Order.find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit + 1)
    .lean<OrderDoc[]>()
    .exec()

  // Se pide limit+1 para saber si hay página siguiente sin un count().
  const hasMore = docs.length > limit
  const page = hasMore ? docs.slice(0, limit) : docs

  const items: OrderView[] = page.map((doc) => ({
    id: doc._id,
    productName: doc.productName,
    priceCents: doc.priceCents,
    createdAt: doc.createdAt.toISOString(),
  }))

  const last = page.at(-1)
  const nextCursor = hasMore && last ? encodeCursor(last.createdAt, last._id) : null

  return { items, nextCursor }
}

/** Cuántas órdenes hay en total. No es O(1) pero se usa solo en el listado. */
export async function countOrders(): Promise<number> {
  return Order.estimatedDocumentCount()
}

export function clampLimit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_LIMIT

  return Math.min(Math.max(1, Math.trunc(value)), MAX_LIMIT)
}

export { encodeCursor, decodeCursor }