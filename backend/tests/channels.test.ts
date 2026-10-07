import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { CHANNELS } from '../src/shared/channels.js'

describe('CHANNELS', () => {
  it('expone orders_events con el nombre exacto del contrato', () => {
    // Este string es parte del contrato con los consumidores: cambiarlo
    // rompe a quien este suscrito. Por eso el valor es fijo.
    assert.equal(CHANNELS.ordersEvents, 'orders_events')
  })

  it('mantiene los canales con prefijo del proyecto', () => {
    assert.equal(CHANNELS.domainEvents, 'cqrs:domain-events')
  })

  it('no duplica nombres de canal', () => {
    const values = Object.values(CHANNELS)
    assert.equal(new Set(values).size, values.length)
  })
})
