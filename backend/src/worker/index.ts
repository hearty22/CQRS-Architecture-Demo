import { logger } from '../shared/logger.js'
import {
  getProjectionStats,
  startOrdersSubscriber,
  stopOrdersSubscriber,
} from './orders-events.subscriber.js'
import { startOutboxRelay, stopOutboxRelay } from './outbox-relay.js'

const log = logger.child('worker')

let running = false

/**
 * El worker vive DENTRO del proceso del backend.
 *
 * GUARDARRAIL 5: se arranca despues de que el server HTTP ya escucha y
 * nunca se importa en el path de un request, asi que una proyeccion
 * lenta no puede bloquear ni degradar la API.
 *
 * GUARDARRAIL 2: `RUN_WORKER=false` lo desactiva sin tocar codigo, y con
 * el flag apagado en una replica el worker se separa a proceso propio
 * sin refactor.
 */
export async function startWorker(): Promise<void> {
  if (running) return
  running = true

  log.info('arrancando')

  // ORDEN IMPORTA: primero se suscribe, despues arranca el relay.
  // Al reves, los eventos que el relay publique en la ventana entre el
  // arranque del relay y la suscripcion se perderian sin destinatario, y
  // Pub/Sub no los reenvia.
  await startOrdersSubscriber()
  startOutboxRelay()

  log.info('listo', getProjectionStats())
}

export async function stopWorker(): Promise<void> {
  if (!running) return
  running = false

  // Al reves del arranque: primero se deja de publicar (relay), despues
  // se corta la suscripcion, para no recibir mensajes que nadie va a leer.
  await stopOutboxRelay()
  await stopOrdersSubscriber()

  log.info('detenido', getProjectionStats())
}

export { getProjectionStats } from './orders-events.subscriber.js'
