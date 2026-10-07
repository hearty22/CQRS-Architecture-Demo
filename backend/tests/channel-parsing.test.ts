import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { CHANNELS, parseEnvelope, parseOrderCreatedPayload } from '../src/shared/channels.js'

/**
 * El bus es fire-and-forget y los mensajes cruzan la red como texto. El
 * typecheck NO ayuda: estos datos llegan sin validar. Estos tests fijan que
 * un mensaje corrupto se rechaza en vez de propagar `undefined` hasta el
 * `$inc`.
 */
describe('parseEnvelope', () => {
  const valid = {
    eventId: 'evt-1',
    channel: 'orders_events',
    aggregateType: 'Order',
    aggregateId: 'ord-1',
    eventType: 'ORDER_CREATED',
    occurredAt: '2026-10-07T02:33:35.097Z',
    payload: { type: 'ORDER_CREATED', orderId: 'ord-1', price: 19.99 },
  }

  it('acepta un envelope bien formado', () => {
    const parsed = parseEnvelope(valid)
    assert.ok(parsed)
    assert.equal(parsed.eventId, 'evt-1')
  })

  it('rechaza null, undefined y no-objetos', () => {
    assert.equal(parseEnvelope(null), null)
    assert.equal(parseEnvelope(undefined), null)
    assert.equal(parseEnvelope('string'), null)
    assert.equal(parseEnvelope(42), null)
    assert.equal(parseEnvelope([]), null)
  })

  it('rechaza un envelope sin eventId', () => {
    assert.equal(parseEnvelope({ ...valid, eventId: undefined }), null)
    assert.equal(parseEnvelope({ ...valid, eventId: '' }), null)
    assert.equal(parseEnvelope({ ...valid, eventId: 123 }), null)
  })

  it('rechaza un envelope con payload no-objeto', () => {
    assert.equal(parseEnvelope({ ...valid, payload: null }), null)
    assert.equal(parseEnvelope({ ...valid, payload: 'x' }), null)
    assert.equal(parseEnvelope({ ...valid, payload: [] }), null)
  })

  it('rechaza un envelope con occurredAt no-string', () => {
    assert.equal(parseEnvelope({ ...valid, occurredAt: 1730000000000 }), null)
  })
})

describe('parseOrderCreatedPayload', () => {
  it('convierte el importe a centavos con redondeo explicito', () => {
    // 19.99 * 100 en IEEE-754 da 1998.9999999999998: sin Math.round, el
    // acumulador quedaria una unidad corta.
    const parsed = parseOrderCreatedPayload({ type: 'ORDER_CREATED', orderId: 'o1', price: 19.99 })
    assert.ok(parsed)
    assert.equal(parsed.priceCents, 1999)
  })

  it('redondea importes con mas decimales', () => {
    const parsed = parseOrderCreatedPayload({
      type: 'ORDER_CREATED',
      orderId: 'o1',
      price: 0.1 + 0.2,
    })
    assert.ok(parsed)
    assert.equal(parsed.priceCents, 30)
  })

  it('acepta importe entero y cero', () => {
    const payload = { type: 'ORDER_CREATED', orderId: 'o1' }
    assert.equal(parseOrderCreatedPayload({ ...payload, price: 42 })?.priceCents, 4200)
    assert.equal(parseOrderCreatedPayload({ ...payload, price: 0 })?.priceCents, 0)
  })

  it('rechaza importes negativos o no finitos', () => {
    const payload = { type: 'ORDER_CREATED', orderId: 'o1' }
    assert.equal(parseOrderCreatedPayload({ ...payload, price: -1 }), null)
    assert.equal(parseOrderCreatedPayload({ ...payload, price: 'NaN' }), null)
    assert.equal(parseOrderCreatedPayload({ ...payload, price: Infinity }), null)
  })

  it('rechaza orderId ausente o vacio', () => {
    assert.equal(parseOrderCreatedPayload({ type: 'ORDER_CREATED', price: 10 }), null)
    assert.equal(parseOrderCreatedPayload({ type: 'ORDER_CREATED', orderId: '', price: 10 }), null)
  })

  it('rechaza importes que exceden el rango seguro', () => {
    assert.equal(parseOrderCreatedPayload({ orderId: 'o1', price: 1e300 }), null)
  })

  it('exige que payload.type sea ORDER_CREATED', () => {
    // Un productor con el schema desfasado puede mandar type:'OTRO' dentro
    // de un envelope ORDER_CREATED. Sin este cruce, el payload se contaria
    // igual y el total quedaria inflado.
    assert.equal(
      parseOrderCreatedPayload({ type: 'OTRO', orderId: 'o1', price: 10 }),
      null,
    )
    assert.equal(
      parseOrderCreatedPayload({ orderId: 'o1', price: 10 }),
      null,
      'un payload sin type tampoco debe pasar',
    )
    assert.ok(
      parseOrderCreatedPayload({ type: 'ORDER_CREATED', orderId: 'o1', price: 10 }),
      'el payload bien formado debe pasar',
    )
  })
})

describe('acumulacion de importes', () => {
  it('sumar en centavos es exacto donde el float deriva', () => {
    // 1.15 x 10 acumulado en float da 11.500000000000002, no 11.5.
    let float = 0
    for (let i = 0; i < 10; i += 1) float += 1.15
    assert.equal(float, 11.500000000000002)

    let cents = 0
    for (let i = 0; i < 10; i += 1) cents += Math.round(1.15 * 100)
    assert.equal(cents / 100, 11.5)
  })

  it('el drift se acumula con volumen', () => {
    // El error no es un caso limite: 1234.56 x 10 en float ya se desvia, y
    // en un dashboard con miles de eventos la diferencia es visible.
    let float = 0
    for (let i = 0; i < 10; i += 1) float += 1234.56
    assert.equal(float, 12345.599999999997)

    let cents = 0
    for (let i = 0; i < 10; i += 1) cents += Math.round(1234.56 * 100)
    assert.equal(cents / 100, 12345.6)
  })

  it('convierte a centavos sin dragre por el redondeo', () => {
    // 0.29 * 100 = 28.999999999999996: sin Math.round quedaria en 28.
    assert.equal(
      parseOrderCreatedPayload({ type: 'ORDER_CREATED', orderId: 'o', price: 0.29 })?.priceCents,
      29,
    )
  })

  it('el canal orders_events conserva su nombre de contrato', () => {
    assert.equal(CHANNELS.ordersEvents, 'orders_events')
  })
})
