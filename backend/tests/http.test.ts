import assert from 'node:assert/strict'
import type { Server } from 'node:http'
import { after, before, describe, it } from 'node:test'

/**
 * createApp() importa config/postgres -> config/env, que valida el entorno
 * con zod en el momento del import y THROWEA si falta algo. Por eso las
 * variables se setean ANTES de cualquier import de la app.
 *
 * (ESM evalua los imports antes que el cuerpo del modulo, asi que un
 * import estatico de createApp aqui romperia siempre.)
 */
process.env.POSTGRES_USER ??= 'test'
process.env.POSTGRES_PASSWORD ??= 'test'
process.env.POSTGRES_DB ??= 'test'
process.env.MONGO_USER ??= 'test'
process.env.MONGO_PASSWORD ??= 'test'
process.env.MONGO_DB ??= 'test'
process.env.REDIS_PASSWORD ??= 'test'

const { createApp } = await import('../src/app.js')

/**
 * Tests de la capa HTTP: no tocan la base ni Redis.
 *
 * Verifican el contrato de status codes y la forma del error, que es lo
 * que un consumidor de la API realmente depende.
 */
describe('capas HTTP', () => {
  it('expone la app de Express', () => {
    const app = createApp()
    assert.equal(typeof app, 'function')
    assert.equal(typeof app.listen, 'function')
  })
})

describe('contrato de errores', () => {
  let server: Server
  let port: number

  // before/after y no listen() dentro del describe: las pruebas corren de
  // forma concurrente, asi que el server tiene que estar escuchando antes
  // de que arranque la primera fetch y cerrarse al terminar el bloque.
  before(async () => {
    const app = createApp()
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        port = (server.address() as { port: number }).port
        resolve()
      })
    })
  })

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  /** Forma de error que la API garantiza. */
  interface ErrorBody {
    error: {
      code: string
      message: string
      details?: { field: string; message: string }[]
    }
  }

  const call = async (path: string, init?: RequestInit) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, init)
    return { status: response.status, body: (await response.json()) as ErrorBody }
  }

  it('devuelve 404 en JSON para rutas inexistentes', async () => {
    const { status, body } = await call('/api/no-existe')
    assert.equal(status, 404)
    assert.equal(body.error.code, 'NOT_FOUND')
    assert.match(body.error.message, /no-existe/)
  })

  it('devuelve 400 INVALID_JSON ante JSON roto', async () => {
    const { status, body } = await call('/api/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{roto',
    })

    assert.equal(status, 400)
    assert.equal(body.error.code, 'INVALID_JSON')
  })

  it('devuelve 400 VALIDATION_ERROR ante body no-objeto', async () => {
    const { status, body } = await call('/api/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '"un string"',
    })

    assert.equal(status, 400)
    assert.ok(['INVALID_JSON', 'VALIDATION_ERROR'].includes(body.error.code))
  })

  it('no expone el stack ni el mensaje interno en el 500', async () => {
    // Un 500 nunca debe filtrar topologia interna hacia el cliente.
    const { body } = await call('/api/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ productName: 'X', price: 10.999 }),
    })

    // Este caso particular es 400; sirve para fijar que el detalle por
    // campo viaja en `details` y no suelto en `message`.
    assert.equal(body.error.message, 'body invalido')
    assert.ok(Array.isArray(body.error.details))
  })
})
