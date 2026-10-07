import { Router } from 'express'

import { dashboardStatsRouter } from './orders/dashboard-stats.routes.js'
import { ordersListRouter } from './orders/orders-list.routes.js'
import { statsEventsRouter } from './stats-events.routes.js'
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

// El stream va ANTES que /stats por seguridad: `use('/stats', ...)` es un
// prefijo, asi que si /stats se montara primero capturaria tambien
// /stats/events. Hoy no rompe porque statsRouter solo declara GET '/' (que
// no matchea '/events'), pero es una trampa para quien agregue una ruta.
queriesRouter.use('/stats/events', statsEventsRouter)

// Read model. Un solo endpoint de datos: /api/stats
queriesRouter.use('/stats', statsRouter)

// Ruta previa, conservada como 301 hacia /api/stats.
queriesRouter.use('/dashboard', dashboardStatsRouter)

/*
 * Listado de órdenes. Se monta DESPUÉS de `/dashboard` a propósito: ambos
 * cuelgan del mismo `commandsRouter` en app.ts, y `use('/dashboard')` es un
 * prefijo, así que el orden tiene que ser explícito para que una ruta futura
 * no quede secuestrada.
 */
queriesRouter.use('/orders', ordersListRouter)
