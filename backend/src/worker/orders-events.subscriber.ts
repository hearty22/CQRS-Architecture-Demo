import { CHANNELS } from '../shared/channels.js'
import { logger } from '../shared/logger.js'
import { parseEnvelope } from '../shared/channels.js'
import { redisSubscriber } from '../config/redis.js'
import { applyOrderCreated } from './order-stats.projection.js'

const log = logger.child('orders-projection')

/**
 * Historial de eventos Applied/duplicate/invalidos. Sirve para el log de
 * arranque y para detectar que el consumidor no esta avanzando.
 */
const stats = { applied: 0, duplicate: 0, invalid: 0 }

export function getProjectionStats() {
  return { ...stats }
}

/**
 * Procesa UN mensaje del bus.
 *
 * Exportada para poder testearla sin levantar Redis. La logica de
 * idempotencia vive en applyOrderCreated, aca solo se enruta.
 */
export async function handleChannelMessage(channel: string, raw: string): Promise<void> {
  if (channel !== CHANNELS.ordersEvents) return

  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(raw)
  } catch {
    // Un JSON roto no puede tumbar el proceso ni frenar el resto de los
    // mensajes: se descarta y sigue.
    stats.invalid += 1
    log.warn('mensaje con JSON invalido, descartado')
    return
  }

  const envelope = parseEnvelope(parsedJson)

  if (!envelope) {
    stats.invalid += 1
    log.warn('envelope con forma inesperada, descartado')
    return
  }

  if (envelope.eventType !== 'ORDER_CREATED') {
    // Evento de otro tipo: hoy no hay proyeccion para el. No es un error.
    log.debug(`evento sin proyeccion: ${envelope.eventType}`)
    return
  }

  try {
    const result = await applyOrderCreated(envelope.eventId, envelope.payload as never)

    if (result.applied) {
      stats.applied += 1
      log.info(`aplicado ${envelope.eventId} (orden ${envelope.aggregateId})`)
    } else if (result.reason === 'already-processed') {
      stats.duplicate += 1
      log.debug(`duplicado ignorado: ${envelope.eventId}`)
    } else {
      stats.invalid += 1
      log.warn(`payload invalido en ${envelope.eventId}, descartado`)
    }
  } catch (error) {
    // Si MongoDB esta caido, el mensaje ya se perdio: Pub/Sub no tiene
    // reintento ni cola. Se loguea y se sigue; el outbox sigue siendo la
    // fuente para poder reprocesar.
    stats.invalid += 1
    log.error(`fallo al aplicar ${envelope.eventId}`, error)
  }
}

/**
 * Suscripcion persistente al bus.
 *
 * ioredis re-suscribe automaticamente tras reconectar, asi que sobrevive
 * a un corte de Redis sin intervencion.
 *
 * OJO: este consumidor depende del relay del outboxpublicando en el MISMO
 * proceso. Si se corre con RUN_WORKER=false no hay quien publique.
 */
export async function startOrdersSubscriber(): Promise<void> {
  redisSubscriber.on('message', (channel: string, message: string) => {
    // fire-and-forget: el handler de ioredis no espera el resultado y no
    // debe hacerlo. Los errores se manejan dentro de handleChannelMessage.
    void handleChannelMessage(channel, message)
  })

  await redisSubscriber.subscribe(CHANNELS.ordersEvents)
  log.info(`suscrito a ${CHANNELS.ordersEvents}`)
}

export async function stopOrdersSubscriber(): Promise<void> {
  try {
    await redisSubscriber.unsubscribe(CHANNELS.ordersEvents)
    log.info(`desuscrito de ${CHANNELS.ordersEvents}`)
  } catch (error) {
    log.warn('fallo al desuscribir', error)
  }
}
