import type { ErrorRequestHandler, RequestHandler } from 'express'
import { ZodError } from 'zod'

import { logger } from './logger.js'

const log = logger.child('http')

/**
 * Body malformado.
 *
 * `express.json()` tira un SyntaxError cuando el body no es JSON valido, y
 * sin este middleware caeria al error handler generico y devolveria 500 por
 * algo que es culpa del cliente. Va ANTES de las rutas para interceptar el
 * fallo del parser.
 */
export const jsonSyntaxErrorHandler: ErrorRequestHandler = (error, _req, res, next) => {
  if (error instanceof SyntaxError && 'body' in error) {
    res.status(400).json({
      error: { code: 'INVALID_JSON', message: 'body no es JSON valido' },
    })
    return
  }

  next(error)
}

/** 404 explicito: sin esto Express responde con un HTML distinto al de la API. */
export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: `ruta no encontrada: ${req.method} ${req.path}` },
  })
}

/**
 * Manejo centralizado de errores.
 *
 * Un ZodError significa que el cliente mando algo malo: 400 con el detalle
 * por campo. Cualquier otra cosa es nuestro: 500 sin detalle, porque
 * filtrar el mensaje interno en produccion filtra la topologia.
 */
export const errorHandler: ErrorRequestHandler = (error, _req, res, next) => {
  if (res.headersSent) {
    next(error)
    return
  }

  if (error instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'body invalido',
        details: error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
      },
    })
    return
  }

  log.error('error no controlado', error)
  res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'error interno' },
  })
}
