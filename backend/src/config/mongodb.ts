import mongoose from 'mongoose'

import { logger } from '../shared/logger.js'
import { MONGODB_URI, env } from './env.js'

const log = logger.child('mongodb')

/**
 * LADO DE LECTURA. Read models desnormalizados, alimentados por las
 * proyecciones que consumen los eventos de Redis.
 *
 * MongoDB nunca es fuente de verdad: si un read model se pierde, se
 * reconstruye reprocesando el outbox.
 */
let pending: Promise<typeof mongoose> | null = null

export function connectMongo(): Promise<typeof mongoose> {
  if (!pending) {
    pending = mongoose
      .connect(MONGODB_URI, {
        dbName: env.MONGO_DB,
        serverSelectionTimeoutMS: 10_000,
      })
      .then((m) => {
        log.info(`conectado a ${env.MONGO_HOST}:${env.MONGO_PORT}/${env.MONGO_DB}`)
        return m
      })
      .catch((error: unknown) => {
        // Se limpia la promesa para permitir reintentar en el proximo arranque.
        pending = null
        throw error
      })
  }

  return pending
}

export async function disconnectMongo(): Promise<void> {
  if (!pending) return
  pending = null
  await mongoose.disconnect()
  log.info('desconectado')
}
