import { Router } from 'express'

import { dashboardStatsRouter } from './orders/dashboard-stats.routes.js'
import { statsRouter } from './stats.routes.js'

/**
 * Raiz del query side.
 *
 * Solo LEE, y lee de MongoDB. Nunca toca Postgres: consultar la tabla de
 * escritura desde un endpoint de lectura es el anti-patron de CQRS.
 *
 * A diferencia del command side, este arbol SI puede (y debe) conocer
 * MongoDB.
 */
export const queriesRouter = Router()

// Read model. Un solo endpoint: /api/stats
queriesRouter.use('/stats', statsRouter)

// Ruta previa, conservada como 301 hacia /api/stats.
queriesRouter.use('/dashboard', dashboardStatsRouter)
