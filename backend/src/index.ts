import { createApp } from './app.js'
import { connectMongo, disconnectMongo } from './config/mongodb.js'
import { connectPostgres, disconnectPostgres } from './config/postgres.js'
import { connectRedis, disconnectRedis } from './config/redis.js'
import { env } from './config/env.js'
import { logger } from './shared/logger.js'
import { startWorker, stopWorker } from './worker/index.js'

const log = logger.child('bootstrap')

const SHUTDOWN_TIMEOUT_MS = 10_000

async function main(): Promise<void> {
  log.info('abriendo conexiones...')

  // Conectamos los tres antes de escuchar: si la infra no esta lista,
  // preferimos morir en el arranque y que el orchestrator reinicie, que
  // levantar un server que contesta 500 en cada request.
  await Promise.all([connectPostgres(), connectMongo(), connectRedis()])

  const app = createApp()
  const server = app.listen(env.PORT, () => {
    log.info(`API escuchando en http://localhost:${env.PORT}`)
    log.info(`worker en proceso: ${env.RUN_WORKER ? 'activo' : 'desactivado (RUN_WORKER=false)'}`)
  })

  // GUARDARRAIL 5 - el worker arranca DESPUES de que el server escucha.
  if (env.RUN_WORKER) {
    await startWorker()
  }

  let shuttingDown = false

  /**
   * GUARDARRAIL 6 - cierre en dos fases.
   *
   * Primero se corta el worker (relay + subscriber), despues el HTTP, y
   * recien ahi las conexiones. Al reves, el relay podria publicar contra
   * un subscriber que ya se fue.
   */
  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return
    shuttingDown = true

    log.info(`${signal} recibido, cerrando...`)

    const forceExit = setTimeout(() => {
      log.error(`cierre forzado: no termino en ${SHUTDOWN_TIMEOUT_MS}ms`)
      process.exit(1)
    }, SHUTDOWN_TIMEOUT_MS)
    forceExit.unref()

    await stopWorker()

    await new Promise<void>((resolve) => {
      server.close(() => resolve())
    })

    await Promise.allSettled([disconnectPostgres(), disconnectMongo(), disconnectRedis()])

    clearTimeout(forceExit)
    log.info('cierre completo')
    process.exit(0)
  }

  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
}

main().catch((error: unknown) => {
  log.error('no se pudo arrancar la API', error)
  process.exit(1)
})
