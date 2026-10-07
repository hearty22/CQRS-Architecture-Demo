import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { readSignal } from '../src/hooks/useStats.ts'

function event(data: string): MessageEvent {
  return { data } as MessageEvent
}

describe('readSignal', () => {
  it('parsea revision y modelo orders', () => {
    const signal = readSignal(event(JSON.stringify({ revision: 7, model: 'orders' })))

    assert.deepEqual(signal, { revision: 7, model: 'orders' })
  })

  it('parsea revision y modelo stats', () => {
    const signal = readSignal(event(JSON.stringify({ revision: 3, model: 'stats' })))

    assert.deepEqual(signal, { revision: 3, model: 'stats' })
  })

  it('cae a stats si falta model (payload viejo)', () => {
    const signal = readSignal(event(JSON.stringify({ revision: 2 })))

    assert.deepEqual(signal, { revision: 2, model: 'stats' })
  })

  it('descarta payloads malformados', () => {
    assert.equal(readSignal(event('no es json')), null)
    assert.equal(readSignal(event(JSON.stringify({ model: 'orders' }))), null)
    assert.equal(readSignal(event(JSON.stringify(null))), null)
  })
})
