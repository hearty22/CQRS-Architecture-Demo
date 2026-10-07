/**
 * Resetea el estado de desarrollo y vuelve a sembrar.
 *
 * Deja el sistema como si recien migrase: sin ordenes, sin eventos
 * pendientes y sin read models. Necesario cuando el outbox y MongoDB
 * quedan desincronizados entre pruebas manuales.
 *
 * Uso:
 *   pnpm db:reset              # limpia y siembra 20 ordenes
 *   pnpm db:reset -- 50        # 50 ordenes
 */

import { logger } from '../shared/logger.js'
import { connectMongo, disconnectMongo } from '../config/mongodb.js'
import { disconnectPostgres, prisma } from '../config/postgres.js'
import { disconnectRedis } from '../config/redis.js'
import { DashboardStats, DASHBOARD_STATS_ID } from '../queries/dashboard-stats.model.js'
import { handleCreateOrder } from '../commands/orders/create-order.handler.js'
import { startWorker, stopWorker } from '../worker/index.js'

const log = logger.child('db:reset')

const DEFAULT_ORDERS = 20

function parseCount(argv: readonly string[]): number {
  const flagIndex = argv.indexOf('--')
  const args = flagIndex >= 0 ? argv.slice(flagIndex + 1) : []

  const asNumber = Number(args.find((arg) => !arg.startsWith('--')))
  if (!Number.isInteger(asNumber) || asNumber < 0) return DEFAULT_ORDERS

  return asNumber
}

// Espejo del catalogo de precios del seed, para que reset deje el mismo
// estado que `pnpm seed` sin importar el archivo entero.
const PRICES: readonly number[] = [
  19.99, 1.15, 1234.56, 0.07, 349.9, 42, 0.29, 3.33, 10.08, 99.95,
  15.5, 7.77, 249.99, 0.01, 88.88, 12.34, 5.6, 150, 67.89, 0.45,
]

async function main(): Promise<void> {
  const count = parseCount(process.argv)

  log.info('parando el worker para no competir con el reset')
  await stopWorker()

  // MongoDB se conecta aca a proposito: este script se ejecuta por
  // `docker compose run`, un contenedor NUEVO que no paso por el bootstrap
  // de src/index.ts. Sin esto, mongoose queda en modo buffer y la primera
  // operacion expira a los 10s con "buffering timed out".
  await connectMongo()

  await prisma.outbox.deleteMany({})
  await prisma.order.deleteMany({})
  log.info('orders y outbox vaciados')

  // El read model se borra entero, no se resetea a 0: con el $push de
  // processedEventIds, un reset parcial dejaria ids viejos y la
  // deduplicacion los trataria como ya vistos.
  const deleted = await DashboardStats.deleteOne({ _id: DASHBOARD_STATS_ID })
  log.info(`dashboard_stats borrado (${deleted.deletedCount})`)

  for (let index = 0; index < count; index += 1) {
    await handleCreateOrder({
      productName: `Seed ${index + 1}`,
      price: PRICES[index % PRICES.length] ?? 10,
    })
  }

  log.info(`${count} ordenes sembradas, reactivando el worker`)

  // Se rearranca para que el relay publique lo recien sembrado y el
  // dashboard quede poblado sin tener que reiniciar el backend a mano.
  await startWorker()
  log.info('worker reactivado')
}

main()
  .catch((error: unknown) => {
    log.error('fallo el reset', error)
    process.exitCode = 1
  })
  .finally(async () => {
    // Hay que detener el worker y cerrar Redis ademas de las bases: el
    // subscriber mantiene una conexion TCP abierta, y con ella el event
    // loop sigue vivo y el script NO termina nunca.
    await stopWorker()
    await Promise.allSettled([disconnectPostgres(), disconnectMongo(), disconnectRedis()])
  })
