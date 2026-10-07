/**
 * Canales del event bus.
 *
 * Redis no tiene namespaces, asi que los canales se prefijan para no
 * colisionar con otras apps que compartan instancia.
 */
export const CHANNELS = {
  /** Fluxo unico de eventos de dominio hacia las proyecciones. */
  domainEvents: 'cqrs:domain-events',

  /**
   * Eventos del agregado Order.
   *
   * A proposito NO lleva el prefijo `cqrs:` que usan los demas: el
   * nombre del canal es parte del contrato con los consumidores y una
   * evolucion del prefijo interno no debe romperlos.
   */
  ordersEvents: 'orders_events',
} as const

export type ChannelName = (typeof CHANNELS)[keyof typeof CHANNELS]

/** Envoltura estandar que viaja por el bus. */
export interface DomainEventEnvelope<TPayload = unknown> {
  /** Id del registro del outbox. Sirve de clave de idempotencia. */
  eventId: string
  channel: ChannelName | string
  aggregateType: string
  aggregateId: string
  eventType: string
  occurredAt: string
  payload: TPayload
}

// --------------------------------------------------------------
// Eventos de dominio
//
// Cada payload lleva SIEMPRE el id del agregado: sin el, una
// proyeccion no puede saber que documento de MongoDB actualizar.
// --------------------------------------------------------------

/**
 * `type` y no `interface` a proposito: Prisma exige `InputJsonObject`, y
 * solo los type alias de objeto literales reciben la firma de indice
 * implicita que lo hace asignable. Con `interface` el typecheck falla.
 */
export type OrderCreatedPayload = {
  type: 'ORDER_CREATED'
  orderId: string
  productName: string
  /** Numero plano: Decimal serializa a string y el consumidor lo quiere numerico. */
  price: number
  occurredAt: string
}

// --------------------------------------------------------------
// Parseo de envelopes
//
// El bus es fire-and-forget: el mensaje puede llegar corrupto, de otra
// version del schema o de otro productor. El typecheck de TypeScript NO
// ayuda aca porque el dato cruza la red como texto. Por eso el unico
// lugar confiable es validar en runtime, y hacerlo con la funcion mas
// simple que funciona.
// --------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseEnvelope(raw: unknown): DomainEventEnvelope | null {
  if (!isRecord(raw)) return null

  const { eventId, channel, aggregateType, aggregateId, eventType, occurredAt, payload } = raw

  if (
    typeof eventId !== 'string' ||
    eventId.length === 0 ||
    typeof channel !== 'string' ||
    typeof aggregateType !== 'string' ||
    typeof aggregateId !== 'string' ||
    typeof eventType !== 'string' ||
    typeof occurredAt !== 'string' ||
    !isRecord(payload)
  ) {
    return null
  }

  return {
    eventId,
    channel,
    aggregateType,
    aggregateId,
    eventType,
    occurredAt,
    payload,
  }
}

/** Valida el payload de ORDER_CREATED. Devuelve null si no calza. */
export function parseOrderCreatedPayload(
  payload: Record<string, unknown>,
): { orderId: string; priceCents: number } | null {
  const { type, orderId, price } = payload

  // El `type` del payload se cruza contra el evento. El dispatcher ya
  // filtro por `eventType`, pero un productor con un schema desfasado
  // puede mandar type: 'OTRO' dentro de un envelope ORDER_CREATED: sin
  // este chequeo, ese payload se contaria igual.
  if (type !== 'ORDER_CREATED') return null

  if (typeof orderId !== 'string' || orderId.length === 0) return null
  if (typeof price !== 'number' || !Number.isFinite(price) || price < 0) return null

  // El importe viaja como numero plano desde el command side. Se convierte
  // a centavos AQUI, una sola vez, con redondeo explicito: Math.round evita
  // el arrastre del punto flotante (19.99 * 100 = 1998.9999...).
  const priceCents = Math.round(price * 100)

  if (!Number.isSafeInteger(priceCents)) return null

  return { orderId, priceCents }
}
