import { Router } from 'express'

import { startWorker, stopWorker } from '../worker/index.js'

/**
 * Endpoints SOLO de demo (DEMO_MODE=true).
 *
 * Permiten congelar y reanudar la proyección desde la UI, sin tocar
 * docker compose ni consola. Guardar una orden con la proyección pausada,
 * mirar cómo el read model no cambia, y reanudar para ver el catch-up es la
 * mejor demostración del outbox que se puede hacer en vivo.
 */
export const demoRouter = Router()

let paused = false

demoRouter.post('/pause', async (_req, res, next) => {
  try {
    if (!paused) {
      await stopWorker()
      paused = true
    }

    res.json({ data: { paused } })
  } catch (caught) {
    next(caught)
  }
})

demoRouter.post('/resume', async (_req, res, next) => {
  try {
    if (paused) {
      await startWorker()
      paused = false
    }

    res.json({ data: { paused } })
  } catch (caught) {
    next(caught)
  }
})

demoRouter.get('/status', (_req, res) => {
  res.json({ data: { paused } })
})
