import { Router } from 'express'

import { countOrders, listOrders } from './order.read-model.js'

/**
 * GET /api/orders
 *
 * Read model. Solo MongoDB, nunca Postgres: consultar la tabla de escritura
 * desde un endpoint de lectura es el anti-patrón de CQRS, y hay un test que
 * falla si este archivo importa el lado de escritura.
 *
 * Consistencia eventual: la lista puede no incluir todavía el último POST,
 * que es el mismo contrato que el de /api/stats.
 */
export const ordersListRouter = Router()

ordersListRouter.get('/', async (req, res) => {
  const { limit, cursor } = req.query

  const page = await listOrders({
    limit: parseLimit(limit),
    cursor: parseCursor(cursor),
  })

  const total = await countOrders()

  res.status(200).json({
    // `priceCents` viaja entero y sin tocar: es la fuente de verdad. El
    // read model no calcula nada, y el precio en decimales es una
    // proyección de presentación que hace el cliente.
    data: page.items,
    meta: {
      total,
      nextCursor: page.nextCursor,
    },
  })
})

function parseLimit(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function parseCursor(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}