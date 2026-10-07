import { Router } from 'express'

/**
 * GET /api/dashboard/stats -> 301 a /api/stats
 *
 * Ruta previa a la fase 4. Se mantiene como redirect permanente para no
 * romper a los consumidores que ya la usan, en vez de dejarla sirviendo
 * un segundo endpoint con el mismo dato (dos rutas, misma respuesta, y
 * cada consumidor nuevo tiene que adivinar cual es la buena).
 *
 * El 301 lo cachea el browser, asi que la redireccion se resuelve una vez.
 */
export const dashboardStatsRouter = Router()

dashboardStatsRouter.get('/stats', (_req, res) => {
  res.redirect(301, '/api/stats')
})
