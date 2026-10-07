import { z } from 'zod'

/**
 * Fuente unica de verdad de la configuracion.
 *
 * Todo el resto del codigo importa `env` de aca y nunca toca
 * process.env directamente: asi la app falla rapido y con un mensaje
 * util en lugar de con un undefined en produccion.
 *
 * Guardamos variables DISCRETAS (host, port, user...) en lugar de URIs
 * completas a proposito: dentro de docker-compose los hosts cambian a
 * `postgres`, `mongodb` y `redis`, y derivarlos aca evita duplicar la
 * logica de conexion.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  PORT: z.coerce.number().int().positive().default(3000),

  /**
   * Guardarraíl 2: permite apagar el worker sin tocar codigo, para que
   * separarlo a un proceso propio mas adelante sea trivial.
   */
  RUN_WORKER: z
    .string()
    .optional()
    .transform((v) => v === undefined || v === '' || v === 'true' || v === '1'),

  // PostgreSQL - lado de escritura
  POSTGRES_HOST: z.string().min(1).default('localhost'),
  POSTGRES_PORT: z.coerce.number().int().positive().default(5432),
  POSTGRES_USER: z.string().min(1),
  POSTGRES_PASSWORD: z.string().min(1),
  POSTGRES_DB: z.string().min(1),

  // MongoDB - lado de lectura
  MONGO_HOST: z.string().min(1).default('localhost'),
  MONGO_PORT: z.coerce.number().int().positive().default(27017),
  MONGO_USER: z.string().min(1),
  MONGO_PASSWORD: z.string().min(1),
  MONGO_DB: z.string().min(1),

  // Redis - event bus (solo Pub/Sub)
  REDIS_HOST: z.string().min(1).default('localhost'),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  REDIS_PASSWORD: z.string().min(1),
  REDIS_DB: z.coerce.number().int().min(0).default(0),
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(raiz)'}: ${issue.message}`)
    .join('\n')

  throw new Error(
    `Configuracion de entorno invalida.\n${details}\n\n` +
      'Revisá .env o las variables del docker-compose.yml.',
  )
}

export const env = parsed.data

// La password se codifica porque puede traer caracteres especiales.
export const DATABASE_URL =
  `postgresql://${env.POSTGRES_USER}:${encodeURIComponent(env.POSTGRES_PASSWORD)}` +
  `@${env.POSTGRES_HOST}:${env.POSTGRES_PORT}/${env.POSTGRES_DB}?schema=public`

// La base va aparte (dbName) para que el usuario root autentique contra admin.
export const MONGODB_URI =
  `mongodb://${env.MONGO_USER}:${encodeURIComponent(env.MONGO_PASSWORD)}` +
  `@${env.MONGO_HOST}:${env.MONGO_PORT}/?authSource=admin`
