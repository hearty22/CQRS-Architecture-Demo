// Configuracion del Prisma CLI (Prisma 7).
//
// En Prisma 7 la URL del datasource salio de schema.prisma y vive aca.
// Ver: prisma/schema.prisma
import 'dotenv/config'
import { defineConfig, env } from 'prisma/config'

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    // `pnpm prisma db seed` corre esto. El seed de la app es
    // `pnpm seed`, que va por el command handler real y por eso es
    // preferible para sembrar datos de CQRS.
    seed: 'tsx src/seed/seed.ts',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
})
