/**
 * Seed de datos de prueba.
 *
 * CORTE IMPORTANTE: el seed usa `handleCreateOrder`, el MISMO handler que
 * el endpoint HTTP, y no un insert directo en la tabla.
 *
 * Es lo que hace que el seed sea de verdad util: si insertara con SQL crudo
 * llenaria `orders` pero no `outbox`, y el dashboard quedaria en cero
 * mientras la tabla muestra 20 ordenes. Es exactamente el bug de
 * inconsistencia que el outbox existe para evitar, y sembrar asi lo
 * reintroduce artificialmente.
 *
 * Uso:
 *   pnpm seed            # 60 ordenes
 *   pnpm seed -- 50      # 50 ordenes
 *   pnpm seed -- 60 --reset   # limpia antes
 */

import { CHANNELS } from '../shared/channels.js'
import { connectMongo, disconnectMongo } from '../config/mongodb.js'
import { disconnectPostgres, prisma } from '../config/postgres.js'
import { DASHBOARD_STATS_ID, DashboardStats } from '../queries/dashboard-stats.model.js'
import { env } from '../config/env.js'
import { handleCreateOrder } from '../commands/orders/create-order.handler.js'
import { logger } from '../shared/logger.js'

const log = logger.child('seed')

const DEFAULT_ORDERS = 60

/**
 * Precios que EXPOSEN la deriva de punto flotante.
 *
 * 1.15 x 10 acumulado en float da 11.500000000000002, y 1234.56 x 10 da
 * 12345.599999999997. Con un seed de precios "redondos" (10.00, 20.00) el
 * total saldria bien por casualidad y la exactitud del acumulador en
 * centavos no quedaria probada por nada.
 */
const PRICES: readonly number[] = [
  19.99, 1.15, 1234.56, 0.07, 349.9, 42, 0.29, 3.33, 10.08, 99.95,
  15.5, 7.77, 249.99, 0.01, 88.88, 12.34, 5.6, 150, 67.89, 0.45,
]

const PRODUCTS: readonly string[] = [
  'Teclado mecanico',
  'Monitor 27"',
  'Mouse inalambrico',
  'Auriculares ANC',
  'Webcam 4K',
  'Dock USB-C',
  'Laptop Pro 14',
  'Silla ergonomica',
  'Luz de escritorio',
  'Microfono USB',
  'Tablet 11"',
  'Funda para laptop',
  'Cable HDMI 2.1',
  'Bateria externa',
  'Soporte monitor',
]

function parseCount(argv: readonly string[]): number {
  const flagIndex = argv.indexOf('--')
  const args = flagIndex >= 0 ? argv.slice(flagIndex + 1) : []

  const asNumber = Number(args.find((arg) => !arg.startsWith('--')))
  if (!Number.isInteger(asNumber) || asNumber < 0) return DEFAULT_ORDERS

  return asNumber
}

function wantsReset(argv: readonly string[]): boolean {
  const flagIndex = argv.indexOf('--')
  const args = flagIndex >= 0 ? argv.slice(flagIndex + 1) : argv

  return args.includes('--reset')
}

async function reset(): Promise<void> {
  // El orden importa por la FK logica: outbox referencia a orders por
  // aggregate_id. No hay constraint en la base, pero borrar en este orden
  // deja el estado consistente igual.
  await prisma.outbox.deleteMany({})
  await prisma.order.deleteMany({})
  log.info('tablas orders y outbox vaciadas')

  // El read model se BORRA, no se pone en cero.
  //
  // Si solo se resetean los contadores, los processedEventIds viejos
  // quedan y la deduplicacion los trata como "ya vistos": el relay
  // republica las ordenes nuevas con ids distintos, asi que se sumarian
  // bien, pero el documento arrastra un historico que no corresponde.
  // Peor: si se resetea a 0 y quedan ids viejos, un replay de eventos
  // viejos se descartaria como duplicado y el total quedaria mal.
  const deleted = await DashboardStats.deleteOne({ _id: DASHBOARD_STATS_ID })
  log.info(`read model dashboard_stats borrado (${deleted.deletedCount})`)

  if (deleted.deletedCount === 0) {
    log.debug('no habia read model que borrar')
  }
}

async function main(): Promise<void> {
  const count = parseCount(process.argv)
  const resetFirst = wantsReset(process.argv)

  log.info(`sembrando ${count} ordenes${resetFirst ? ' (con reset)' : ''} en ${env.NODE_ENV}`)

  if (resetFirst) {
    // Este script corre por `docker compose run`, un contenedor NUEVO que
    // no paso por el bootstrap de src/index.ts. Sin conectar aca, mongoose
    // queda en modo buffer y el deleteOne expira con "buffering timed out".
    await connectMongo()
    await reset()
  }

  /*
   * Idempotencia por DECISIÓN, no por escritura.
   *
   * Con el servicio `init` de docker-compose, este seed corre en CADA
   * `docker compose up`. Sin este corte, el segundo arranque duplicaría
   * las 20 órdenes y el read model mostraría el doble.
   *
   * Se decide acá y no se hace idempotente la escritura: preguntar "¿ya
   * hay datos?" es una consulta barata y explícita, mientras que hacer el
   * insert idempotente escondería la decisión dentro de la operación.
   */
  const existing = await prisma.order.count()

  if (existing > 0) {
    log.info(`ya hay ${existing} ordenes: no se siembra nada (idempotente)`)
    log.info('para forzar de cero: pnpm seed -- <n> --reset')
    return
  }

  const created: { id: string; price: number }[] = []

  for (let index = 0; index < count; index += 1) {
    const productName = PRODUCTS[index % PRODUCTS.length] ?? 'Producto'
    const price = PRICES[index % PRICES.length] ?? 10

    // handleCreateOrder valida, inserta orders y encola el outbox, todo en
    // una transaccion. Mismo camino que un POST real.
    const order = await handleCreateOrder({ productName, price })
    created.push({ id: order.id, price })
  }

  const expectedCents = created.reduce((total, order) => total + Math.round(order.price * 100), 0)

  log.info(`${created.length} ordenes creadas, esperado ${(expectedCents / 100).toFixed(2)}`)
  log.info(
    `los eventos salen por el canal ${CHANNELS.ordersEvents} cuando arranque el worker`,
  )
}

main()
  .catch((error: unknown) => {
    log.error('fallo el seed', error)
    process.exitCode = 1
  })
  .finally(async () => {
    // await y no void: sin esto el proceso puede salir antes de que las
    // conexiones se cierren y el script deja conexiones colgadas.
    await Promise.allSettled([disconnectPostgres(), disconnectMongo()])
  })
