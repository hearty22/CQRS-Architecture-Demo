import { PrismaPg } from '@prisma/adapter-pg'

import { logger } from '../shared/logger.js'
import { PrismaClient } from '../generated/prisma/client.js'
import { DATABASE_URL, env } from './env.js'

const log = logger.child('postgres')

/**
 * LADO DE ESCRITURA. Fuente de verdad.
 *
 * Prisma 7 usa driver adapters: el engine nativo ya no existe y la
 * conexion la maneja el driver `pg` de Node. Por eso no hay
 * `datasourceUrl` ni bloque `url` en schema.prisma.
 */
const adapter = new PrismaPg({
  connectionString: DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
})

// Singleton con guarda en globalThis: `tsx watch` reevalua los modulos en
// cada cambio y sin esto cada recarga abriria un pool nuevo de conexiones.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter })

if (env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}

export async function connectPostgres(): Promise<void> {
  await prisma.$queryRaw`SELECT 1`
  log.info(`conectado a ${env.POSTGRES_HOST}:${env.POSTGRES_PORT}/${env.POSTGRES_DB}`)
}

export async function disconnectPostgres(): Promise<void> {
  await prisma.$disconnect()
  log.info('desconectado')
}
