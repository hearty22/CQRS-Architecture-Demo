import pg from 'pg'

import type { DomainEventEnvelope } from '../shared/channels.js'
import { logger } from '../shared/logger.js'
import { DATABASE_URL } from '../config/env.js'
import { publish } from '../config/redis.js'
import { prisma } from '../config/postgres.js'

const { Client } = pg

const log = logger.child('outbox-relay')

const POLL_INTERVAL_MS = 1_000
const BATCH_SIZE = 50
const ADVISORY_LOCK_KEY = 7_140_215

let timer: NodeJS.Timeout | null = null
let lockClient: pg.Client | null = null
let stopping = false

/**
 * GUARDARRAIL 1 - una sola replica hace el relay.
 *
 * `pg_try_advisory_lock` es de SESION: vive atado a una conexion fisica,
 * no a una transaccion. El pool de Prisma puede atender cada query en una
 * conexion distinta, asi que pedirlo por `$queryRaw` seria incierto y el
 * `unlock` podria caer en otra conexion dejando el lock huerfano para
 * siempre (la replica actual creeria que lo tiene y otra lo tomaria).
 *
 * Por eso el lock usa un `pg.Client` dedicado: una unica conexion fisica
 * para toda la vida del proceso.
 *
 * Se usa Postgres y no Redis a proposito: Redis en este proyecto es solo
 * Pub/Sub, y un SET NX para lock contradiria esa regla.
 */
async function acquireLock(): Promise<boolean> {
  const client = new Client({ connectionString: DATABASE_URL })
  await client.connect()

  const result = await client.query<{ locked: boolean }>(
    'SELECT pg_try_advisory_lock($1::bigint) AS locked',
    [ADVISORY_LOCK_KEY],
  )

  if (result.rows[0]?.locked !== true) {
    await client.end().catch(() => undefined)
    return false
  }

  lockClient = client
  return true
}

async function releaseLock(): Promise<void> {
  if (!lockClient) return

  const client = lockClient
  lockClient = null

  try {
    await client.query('SELECT pg_advisory_unlock($1::bigint)', [ADVISORY_LOCK_KEY])
  } catch (error) {
    log.warn('no se pudo liberar el advisory lock', error)
  } finally {
    await client.end().catch(() => undefined)
  }
}

interface OutboxRow {
  id: string
  channel: string
  payload: unknown
  aggregate_type: string
  aggregate_id: string
  event_type: string
  occurred_at: Date
}

/**
 * Publica un lote de eventos pendientes.
 *
 * Devuelve cuantos se publicaron. El loop de `tick` sigue mientras el
 * lote venga lleno para vaciar la cola de una.
 */
async function processBatch(): Promise<number> {
  return prisma.$transaction(async (tx) => {
    // GUARDARRAIL 3 - FOR UPDATE SKIP LOCKED: aunque el lock se perdiera,
    // dos tomadores nunca pelean por las mismas filas.
    const rows = await tx.$queryRaw<OutboxRow[]>`
      SELECT id, channel, payload, aggregate_type, aggregate_id, event_type, occurred_at
      FROM outbox
      WHERE published_at IS NULL
      ORDER BY occurred_at ASC
      LIMIT ${BATCH_SIZE}
      FOR UPDATE SKIP LOCKED
    `

    if (rows.length === 0) return 0

    let published = 0

    for (const row of rows) {
      const envelope: DomainEventEnvelope = {
        eventId: row.id,
        channel: row.channel,
        aggregateType: row.aggregate_type,
        aggregateId: row.aggregate_id,
        eventType: row.event_type,
        occurredAt: row.occurred_at.toISOString(),
        payload: row.payload,
      }

      try {
        // Se publica SOLO despues del commit que creo la fila; nunca antes.
        await publish(row.channel, JSON.stringify(envelope))

        await tx.$executeRaw`
          UPDATE outbox
          SET published_at = now(), attempts = attempts + 1, last_error = NULL
          WHERE id = ${row.id}::uuid
        `
        published += 1
      } catch (error) {
        // GUARDARRAIL 4 - un mensaje envenenado no corta el lote ni tumba
        // el proceso (y con el, la API entera). Queda en cuarentena con su
        // error y se reintenta en el proximo ciclo.
        await tx.$executeRaw`
          UPDATE outbox
          SET attempts = attempts + 1, last_error = ${String(error)}
          WHERE id = ${row.id}::uuid
        `
        log.error(
          `no se pudo publicar ${row.id} (${row.event_type}); queda pendiente para el proximo ciclo`,
          error,
        )
      }
    }

    return published
  })
}

async function tick(): Promise<void> {
  if (stopping) return

  try {
    if (!lockClient) {
      const acquired = await acquireLock()

      if (!acquired) {
        log.debug('otra replica tiene el relay; esta no publica')
        return
      }

      log.info('advisory lock tomado: esta replica relays el outbox')
    }

    let processed = 0
    do {
      processed = await processBatch()
    } while (processed === BATCH_SIZE && !stopping)
  } catch (error) {
    log.error('error en el ciclo del relay', error)
    // Se suelta el lock para reintentarlo limpio en el proximo tick.
    await releaseLock()
  }
}

export function startOutboxRelay(): void {
  if (timer) return

  stopping = false
  timer = setInterval(() => {
    void tick()
  }, POLL_INTERVAL_MS)

  // unref: el timer no debe impedir que el proceso termine.
  timer.unref()

  log.info(`iniciado (poll ${POLL_INTERVAL_MS}ms, batch ${BATCH_SIZE})`)
}

export async function stopOutboxRelay(): Promise<void> {
  stopping = true

  if (timer) {
    clearInterval(timer)
    timer = null
  }

  await releaseLock()
  log.info('detenido')
}
