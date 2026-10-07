import { Router } from 'express'

import { readDashboardStats } from './stats.read-model.js'

/**
 * GET /api/stats
 *
 * Read model. O(1) por construccion: un unico findById sobre el indice
 * `_id_`. Cero calculos matematicos en tiempo real, cero contacto con
 * PostgreSQL, cero contacto con Redis.
 *
 * Consistencia eventual: el total refleja lo que la proyeccion ya
 * aplico, no necesariamente el ultimo POST.
 */
export const statsRouter = Router()

statsRouter.get('/', async (_req, res) => {
  const stats = await readDashboardStats()

  if (!stats) {
    // 404 y no un total en cero: "no hay datos" y "la facturacion es cero"
    // son cosas distintas, y confundirlas muestra 0 en un dashboard.
    res.status(404).json({
      error: {
        code: 'NO_STATS',
        message: 'todavia no hay estadisticas: ningun ORDER_CREATED fue procesado',
      },
    })
    return
  }

  res.status(200).json({ data: stats })
})
