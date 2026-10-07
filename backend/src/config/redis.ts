// ioredis v6 elimino el default export: ahora es un named export.
import { Redis } from 'ioredis'

import { logger } from '../shared/logger.js'
import { env } from './env.js'

const log = logger.child('redis')

function connectionOptions() {
  return {
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    password: env.REDIS_PASSWORD,
    db: env.REDIS_DB,
    // Obligatorio en v6: sin esto ioredis corta los comandos encolados
    // cuando la conexion se cae a mitad de un vuelo.
    maxRetriesPerRequest: null,
    lazyConnect: true,
    retryStrategy: (times: number) => Math.min(times * 200, 2_000),
  }
}

/**
 * EVENT BUS. EXCLUSIVAMENTE Pub/Sub.
 *
 * Redis aqui NO es cache, NO es cola durable, NO es lock, NO son sesiones.
 * Es solo el transporte de eventos entre el command side y las
 * proyecciones. La durabilidad la aporta el outbox de Postgres, no Redis.
 *
 * Son DOS conexiones a proposito: una conexion en modo suscriptor rechaza
 * comandos normales, asi que publicar desde la misma conexion que esta
 * suscrita falla. Publicar y suscribir son el mismo protocolo en Redis y
 * una conexion queda bloqueada en modo subscribe.
 */
export const redisPublisher = new Redis(connectionOptions())
export const redisSubscriber = new Redis(connectionOptions())

/** Publica un evento en un canal. Devuelve cuantos suscriptores lo recibieron. */
export function publish(channel: string, message: string): Promise<number> {
  return redisPublisher.publish(channel, message)
}

export async function connectRedis(): Promise<void> {
  await Promise.all([redisPublisher.connect(), redisSubscriber.connect()])
  log.info(`publisher y subscriber conectados a ${env.REDIS_HOST}:${env.REDIS_PORT}`)
}

export async function disconnectRedis(): Promise<void> {
  // allSettled: si una de las dos conexiones ya esta caída, no queremos
  // abortar el cierre de la otra.
  await Promise.allSettled([redisPublisher.quit(), redisSubscriber.quit()])
  log.info('desconectado')
}
