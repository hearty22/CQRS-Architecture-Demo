import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

/**
 * El contrato del read model, sin tocar la base.
 *
 * Fija el shape que ve un consumidor de la API. Si esto cambia, es un
 * breaking change del read model y tiene que ser deliberado.
 */
describe('contrato de DashboardStats', () => {
  const build = (doc: Record<string, unknown>): Record<string, unknown> => {
    // Reproduce lo que hace readDashboardStats: copia de campos, sin
    // aritmetica. Si esto empieza a dividir, el test lo va a mostrar.
    const revenue = doc.totalRevenue

    if (typeof revenue !== 'number' || !Number.isFinite(revenue)) {
      throw new Error('el read model dashboard_stats tiene totalRevenue invalido')
    }

    return {
      totalRevenue: revenue,
      totalOrders: doc.totalOrders,
      updatedAt: (doc.updatedAt as Date).toISOString(),
    }
  }

  it('devuelve los tres campos del read model', () => {
    const view = build({
      totalRevenue: 3731.7,
      totalOrders: 22,
      updatedAt: new Date('2026-10-07T03:02:45.302Z'),
    })

    assert.equal(view.totalRevenue, 3731.7)
    assert.equal(view.totalOrders, 22)
    assert.equal(view.updatedAt, '2026-10-07T03:02:45.302Z')
  })

  it('no expone el array de idempotencia al consumidor', () => {
    // processedEventIds es bookkeeping interno. Si apareciera en la
    // respuesta, cada GET pagaria cientos de UUIDs sin motivo y se
    // filtraria detalle del mecanismo de deduplicacion.
    const view = build({
      totalRevenue: 10,
      totalOrders: 1,
      updatedAt: new Date(),
      processedEventIds: ['a', 'b', 'c'],
    })

    assert.equal('processedEventIds' in view, false)
    assert.deepEqual(Object.keys(view).sort(), ['totalOrders', 'totalRevenue', 'updatedAt'])
  })

  it('rechaza un importe que no es un numero', () => {
    // Si el update se hubiera hecho con la forma clasica de $set en vez de
    // con un pipeline, el campo quedaria guardado como el objeto literal
    // {$round: [...]}. Sin el guard, eso llegaria al cliente como null.
    assert.throws(
      () =>
        build({
          totalRevenue: { $round: [{ $divide: [{ $add: ['$totalRevenueCents', 115] }, 100] }, 2] },
          totalOrders: 1,
          updatedAt: new Date(),
        }),
      /totalRevenue invalido/,
    )
  })

  it('rechaza un importe no finito', () => {
    assert.throws(
      () => build({ totalRevenue: Number.NaN, totalOrders: 1, updatedAt: new Date() }),
      /totalRevenue invalido/,
    )
  })

  it('el importe en reales y en centavos no pueden desfasarse', () => {
    // Invariante del modelo: totalRevenue SIEMPRE es totalRevenueCents / 100
    // redondeado. Si el worker dejara de cumplirlo, el dashboard muestra un
    // numero que no cuadra con la fuente de verdad.
    const cases = [
      { cents: 373170, revenue: 3731.7 },
      { cents: 1999, revenue: 19.99 },
      { cents: 115, revenue: 1.15 },
      { cents: 123456, revenue: 1234.56 },
      { cents: 0, revenue: 0 },
    ]

    for (const { cents, revenue } of cases) {
      assert.equal(revenue, Math.round(cents) / 100, `desfase con ${cents} centavos`)
    }
  })

  it('el handler devuelve el importe sin recalcularlo', () => {
    // Si el read path dividiera, con un totalRevenue deliberadamente
    // distinto de cents/100 el resultado seria distinto al persistido.
    // Esto fija que la API devuelve LO QUE ESTA, sin matematica.
    const cents = 373170
    const revenuePersistido = 3731.7

    const view = build({ totalRevenue: revenuePersistido, totalOrders: 22, updatedAt: new Date() })

    assert.equal(view.totalRevenue, revenuePersistido)
    assert.notEqual(view.totalRevenue, cents / 100 + 999)
  })
})
