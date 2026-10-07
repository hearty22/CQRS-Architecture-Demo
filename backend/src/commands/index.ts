import { Router } from 'express'

import { ordersRouter } from './orders/orders.routes.js'

/**
 * Raiz del command side.
 *
 * Solo escribe. Ningun modulo bajo commands/ debe montar un GET: en
 * CQRS estricto las lecturas van a los read models de MongoDB.
 */
export const commandsRouter = Router()

commandsRouter.use('/orders', ordersRouter)
