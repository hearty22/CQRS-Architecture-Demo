import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  buildOrderBody,
  describeApiError,
  formatAge,
  formatRevenue,
  isNoStatsError,
  parseStats,
  validateOrderDraft,
} from '../src/api/contract.ts'

/**
 * El contrato con la API vive en funciones puras justamente para poder
 * testearlo sin navegador. Lo que llega por la red no es de fiar: estos
 * tests fijan que un shape raro falla explicito en vez de renderizar NaN.
 */

const validStats = {
  data: { totalRevenue: 2359.75, totalOrders: 20, updatedAt: '2026-10-07T03:20:29.328Z' },
}

describe('parseStats', () => {
  it('acepta la respuesta del read model', () => {
    const parsed = parseStats(validStats)

    assert.equal(parsed.ok, true)
    assert.equal(parsed.empty, false)
    assert.equal(parsed.data?.totalRevenue, 2359.75)
    assert.equal(parsed.data?.totalOrders, 20)
  })

  it('acepta un total de 0 (que es valido, no "sin datos")', () => {
    const parsed = parseStats({
      data: { totalRevenue: 0, totalOrders: 0, updatedAt: '2026-10-07T03:20:29.328Z' },
    })

    assert.equal(parsed.ok, true)
    assert.equal(parsed.data?.totalRevenue, 0)
  })

  it('rechaza un totalRevenue que llega como string', () => {
    // El backend lo devuelve pre-calculado como numero. Si algun dia
    // cambia a string, hay que enterarse y no renderizar NaN.
    const parsed = parseStats({
      data: { totalRevenue: '2359.75', totalOrders: 20, updatedAt: 'x' },
    })

    assert.equal(parsed.ok, false)
  })

  it('rechaza null, arrays y objetos vacios', () => {
    assert.equal(parseStats(null).ok, false)
    assert.equal(parseStats(undefined).ok, false)
    assert.equal(parseStats([]).ok, false)
    assert.equal(parseStats({}).ok, false)
    assert.equal(parseStats({ data: null }).ok, false)
  })

  it('rechaza NaN e Infinity', () => {
    assert.equal(parseStats({ data: { totalRevenue: Number.NaN, totalOrders: 1, updatedAt: 'x' } }).ok, false)
    assert.equal(
      parseStats({ data: { totalRevenue: Infinity, totalOrders: 1, updatedAt: 'x' } }).ok,
      false,
    )
  })

  it('rechaza un updatedAt que no es string', () => {
    const parsed = parseStats({
      data: { totalRevenue: 10, totalOrders: 1, updatedAt: 1730000000000 },
    })

    assert.equal(parsed.ok, false)
  })
})

describe('isNoStatsError', () => {
  it('reconoce el 404 NO_STATS', () => {
    const body = { error: { code: 'NO_STATS', message: 'todavia no hay estadisticas' } }
    assert.equal(isNoStatsError(body), true)
  })

  it('no confunde otros errores', () => {
    assert.equal(isNoStatsError({ error: { code: 'INTERNAL_ERROR' } }), false)
    assert.equal(isNoStatsError({ error: { code: 'NOT_FOUND' } }), false)
    assert.equal(isNoStatsError(null), false)
    assert.equal(isNoStatsError({}), false)
  })
})

describe('describeApiError', () => {
  it('usa el primer detalle por campo cuando hay', () => {
    const body = {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'body invalido',
        details: [{ field: 'price', message: 'price admite maximo 2 decimales' }],
      },
    }

    assert.equal(describeApiError(body), 'price: price admite maximo 2 decimales')
  })

  it('cae al mensaje general si no hay detalles', () => {
    assert.equal(
      describeApiError({ error: { code: 'INTERNAL_ERROR', message: 'error interno' } }),
      'error interno',
    )
  })

  it('tiene un fallback para cuerpos irreconocibles', () => {
    assert.equal(describeApiError(null), 'error inesperado del servidor')
    assert.equal(describeApiError('texto'), 'error inesperado del servidor')
  })
})

describe('validateOrderDraft', () => {
  const draft = (productName: string, price: string) => ({ productName, price })

  it('acepta un draft valido', () => {
    assert.deepEqual(validateOrderDraft(draft('Teclado', '19.99')), [])
  })

  it('acepta 1.99, que en float es 198.9999...', () => {
    // Mismo epsilon que el backend. Sin el, el formulario rechazaria un
    // precio que la API acepta.
    assert.deepEqual(validateOrderDraft(draft('X', '1.99')), [])
  })

  it('rechaza nombre vacio o solo espacios', () => {
    assert.equal(validateOrderDraft(draft('', '10')).length, 1)
    assert.equal(validateOrderDraft(draft('   ', '10')).length, 1)
  })

  it('rechaza nombre de mas de 255 caracteres', () => {
    assert.equal(validateOrderDraft(draft('a'.repeat(256), '10')).length, 1)
    assert.equal(validateOrderDraft(draft('a'.repeat(255), '10')).length, 0)
  })

  it('rechaza precio vacio, no numerico, cero o negativo', () => {
    assert.equal(validateOrderDraft(draft('X', '')).length, 1)
    assert.equal(validateOrderDraft(draft('X', 'abc')).length, 1)
    assert.equal(validateOrderDraft(draft('X', '0')).length, 1)
    assert.equal(validateOrderDraft(draft('X', '-5')).length, 1)
  })

  it('rechaza mas de 2 decimales en vez de redondear', () => {
    const errors = validateOrderDraft(draft('X', '10.999'))

    assert.equal(errors.length, 1)
    assert.match(errors[0]?.message ?? '', /2 decimales/)
  })

  it('acumula varios errores a la vez', () => {
    assert.equal(validateOrderDraft(draft('', 'abc')).length, 2)
  })
})

describe('buildOrderBody', () => {
  it('arma el body con el precio como numero', () => {
    assert.deepEqual(buildOrderBody({ productName: '  Teclado  ', price: ' 19.99 ' }), {
      productName: 'Teclado',
      price: 19.99,
    })
  })

  it('devuelve null si el draft es invalido', () => {
    assert.equal(buildOrderBody({ productName: '', price: '10' }), null)
    assert.equal(buildOrderBody({ productName: 'X', price: '-1' }), null)
  })
})

describe('formatRevenue', () => {
  it('formatea a 2 decimales', () => {
    assert.match(formatRevenue(2359.75), /2[.,]359,75|2,359\.75/)
  })

  it('no pierde centavos en valores chicos', () => {
    assert.match(formatRevenue(0.01), /0[.,]01/)
    assert.doesNotMatch(formatRevenue(0.01), /0[.,]00/)
  })

  it('formatea el cero', () => {
    assert.match(formatRevenue(0), /0/)
  })
})

describe('formatAge', () => {
  const now = new Date('2026-10-07T12:00:00.000Z')

  it('distingue recien de hace rato', () => {
    assert.equal(formatAge('2026-10-07T11:59:59.000Z', now), 'hace instantes')
    assert.equal(formatAge('2026-10-07T11:59:30.000Z', now), 'hace 30 s')
  })

  it('escala a minutos, horas y dias', () => {
    assert.equal(formatAge('2026-10-07T11:30:00.000Z', now), 'hace 30 min')
    assert.equal(formatAge('2026-10-07T09:00:00.000Z', now), 'hace 3 h')
    assert.equal(formatAge('2026-10-05T12:00:00.000Z', now), 'hace 2 d')
  })

  it('nunca muestra un tiempo negativo (reloj desfasado)', () => {
    // Si el reloj del navegador va atras que el del servidor, la resta
    // daria negativo y "hace -5 s" seria un bug visible.
    assert.equal(formatAge('2026-10-07T12:05:00.000Z', now), 'hace instantes')
  })

  it('devuelve desconocido ante una fecha invalida', () => {
    assert.equal(formatAge('no-es-fecha', now), 'desconocido')
  })
})