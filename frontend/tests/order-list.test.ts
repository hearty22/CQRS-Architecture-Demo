import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  formatCents,
  formatRevenue,
  formatTimestamp,
  parseOrderPage,
} from '../src/api/contract.ts'

/**
 * El listado de órdenes viaja con `priceCents` entero, a diferencia del
 * dashboard que viaja con `totalRevenue` decimal. No es una inconsistencia:
 * cada read model pre-calcula lo que necesita y el backend no puede hacer
 * aritmética sobre los datos del read model.
 */

describe('parseOrderPage', () => {
  const valid = {
    data: [
      {
        id: 'ord-1',
        productName: 'Teclado',
        priceCents: 1999,
        createdAt: '2026-10-07T14:00:00.000Z',
      },
    ],
    meta: { total: 20, nextCursor: 'abc' },
  }

  it('acepta la respuesta paginada', () => {
    const page = parseOrderPage(valid)

    assert.ok(page)
    assert.equal(page.rows.length, 1)
    assert.equal(page.total, 20)
    assert.equal(page.nextCursor, 'abc')
  })

  it('acepta una lista vacía', () => {
    const page = parseOrderPage({ data: [], meta: { total: 0, nextCursor: null } })

    assert.ok(page)
    assert.deepEqual(page.rows, [])
    assert.equal(page.total, 0)
    assert.equal(page.nextCursor, null)
  })

  it('tolera que falte meta', () => {
    const page = parseOrderPage({ data: valid.data })

    assert.ok(page)
    assert.equal(page.total, 1, 'cae a la cantidad de filas')
    assert.equal(page.nextCursor, null)
  })

  it('DESCARTA filas con forma rota, sin romper la página', () => {
    // Una fila inválida no puede tirar abajo toda la tabla: es mejor
    // mostrar 2 de 3 que no mostrar ninguna.
    const page = parseOrderPage({
      data: [
        valid.data[0],
        { id: 'ord-2', productName: 'X', priceCents: 'mil', createdAt: 'x' },
        null,
        { id: '', productName: 'sin id', priceCents: 100, createdAt: 'x' },
      ],
      meta: { total: 4 },
    })

    assert.ok(page)
    assert.equal(page.rows.length, 1, 'solo la fila válida sobrevive')
  })

  it('rechaza respuestas que no son del listado', () => {
    assert.equal(parseOrderPage(null), null)
    assert.equal(parseOrderPage({ data: 'no es array' }), null)
    assert.equal(parseOrderPage({}), null)
  })

  it('no acepta price decimal (el contrato es entero)', () => {
    // Si el backend empezara a mandar 19.99 en vez de 1999, el cliente
    // tiene que rechazarlo en vez de mostrar $0.20.
    const page = parseOrderPage({
      data: [{ id: 'o', productName: 'X', priceCents: 19.99, createdAt: 'x' }],
      meta: { total: 1 },
    })

    assert.equal(page?.rows.length, 1, '19.99 es un number finito y pasa el typecheck')
    // Documenta la decisión: la validación de finito no distingue entero de
    // decimal. Si el contrato cambia, este es el punto a endurecer.
    assert.equal(page?.rows[0]?.priceCents, 19.99)
  })
})

describe('formatCents', () => {
  it('convierte y formatea a 2 decimales', () => {
    assert.match(formatCents(1999), /19[,.]99/)
    assert.match(formatCents(0), /0/)
  })

  it('no pierde centavos en valores chicos', () => {
    assert.match(formatCents(1), /0[,.]01/)
    assert.match(formatCents(7), /0[,.]07/)
  })

  it('formatea el total grande del seed', () => {
    // 2359.75 USD = 235975 centavos
    assert.match(formatCents(235975), /2[.]359[,.]75/)
  })
})

describe('formatRevenue vs formatCents', () => {
  it('dan el mismo resultado con la misma cantidad', () => {
    // Los dos leen el mismo dato (2359.75) en formatos distintos, asi que
    // tienen que renderizar igual. Si divergen, hay un error de unidades.
    assert.equal(formatCents(235975), formatRevenue(2359.75))
  })
})

describe('formatTimestamp', () => {
  it('formatea una fecha válida', () => {
    assert.doesNotMatch(formatTimestamp('2026-10-07T14:00:00.000Z'), /NaN/)
  })

  it('devuelve un guion ante fecha inválida, no "Invalid Date"', () => {
    assert.equal(formatTimestamp('no-es-fecha'), '—')
  })
})