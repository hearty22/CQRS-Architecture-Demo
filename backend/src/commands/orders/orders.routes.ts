import { Router } from 'express'

import { createOrderSchema } from './create-order.command.js'
import { handleCreateOrder } from './create-order.handler.js'

/**
 * POST /api/orders
 *
 * No lleva try/catch: Express 5 propaga solo los rechazos de handlers
 * async al error middleware.
 */
export const ordersRouter = Router()

ordersRouter.post('/', async (req, res) => {
  const input = createOrderSchema.parse(req.body)
  const order = await handleCreateOrder(input)

  res.status(201).json({ data: order })
})
