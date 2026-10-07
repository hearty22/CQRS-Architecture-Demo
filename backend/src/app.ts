import cors from 'cors'
import express from 'express'

import { commandsRouter } from './commands/index.js'
import { demoRouter } from './demo/demo.routes.js'
import { errorHandler, jsonSyntaxErrorHandler, notFoundHandler } from './shared/errors.js'
import { queriesRouter } from './queries/index.js'

/**
 * Fabrica de la app Express, separada de `index.ts` a proposito: asi se
 * puede testear con supertest sin abrir un puerto.
 */
export function createApp() {
  const app = express()

  app.disable('x-powered-by')

  // En dev el browser nunca cruza origenes porque Vite proxea /api, asi que
  // esto es una red de seguridad para acceso directo a la API.
  app.use(cors())

  // Express 5 propaga solo los rechazos de handlers async al error
  // middleware, no hace falta envolver cada handler.
  app.use(express.json({ limit: '1mb' }))

  // DESPUES de express.json() a proposito: el SyntaxError lo produce el
  // parser, asi que el middleware tiene que estar montado abajo. Si se
  // registra antes, nunca ve el error y un body roto devuelve 500.
  app.use(jsonSyntaxErrorHandler)

  // Command side: escribe. Query side: lee de MongoDB.
  app.use('/api', commandsRouter)
  app.use('/api', queriesRouter)

  // Demo en vivo: pausar/reanudar la proyección desde la UI. Sin el flag
  // estas rutas ni se registran — nunca expuestas en producción.
  if (process.env.DEMO_MODE === 'true') {
    app.use('/api/_demo', demoRouter)
  }

  // Al final: si el 404 se registra antes de las rutas nunca se dispara.
  app.use(notFoundHandler)

  // Fuente unica de errores. Debe ser el ULTIMO middleware: registrado
  // antes, Express lo trata como middleware normal y no captura nada.
  app.use(errorHandler)

  return app
}
