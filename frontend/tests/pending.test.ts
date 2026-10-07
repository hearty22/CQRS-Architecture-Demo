import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  emptyPending,
  isReconciled,
  shouldClearNotice,
  trackOrder,
} from '../src/state/pending.ts'

/**
 * Este estado tiene ciclo de vida y antes estaba dentro del componente,
 * donde no se podia testear. El bug que motivo extraerlo: el contador
 * subia y nunca bajaba, y el banner se quedaba para siempre diciendo "1
 * orden guardada".
 */

describe('contador de pendientes', () => {
  it('arranca en cero', () => {
    assert.deepEqual(emptyPending, { count: 0, baseline: null })
  })

  it('cuenta una orden guardada', () => {
    const state = trackOrder(emptyPending, 20)

    assert.equal(state.count, 1)
    assert.equal(state.baseline, 20)
  })

  it('cuenta varias y mantiene el baseline de la primera', () => {
    // Si el baseline se recapturara en cada alta, avanzaría junto con el
    // read model y la reconciliación nunca se cumpliría.
    let state = trackOrder(emptyPending, 20)
    state = trackOrder(state, 20)
    state = trackOrder(state, 21)

    assert.equal(state.count, 3)
    assert.equal(state.baseline, 20, 'el baseline no debe moverse')
  })

  it('no se reconcilia mientras el read model va atrás', () => {
    const state = trackOrder(emptyPending, 20)

    assert.equal(isReconciled(state, 20), false)
    assert.equal(isReconciled(state, null), false)
  })

  it('se reconcilia cuando el read model alcanza el total esperado', () => {
    const state = trackOrder(emptyPending, 20)

    assert.equal(isReconciled(state, 21), true)
  })

  it('aguanta que el read model venga adelantado (otra pestaña guardó)', () => {
    // Si el usuario tiene dos pestañas, la segunda puede proyectar la orden
    // de la primera y el total salta más de lo esperado.
    const state = trackOrder(emptyPending, 20)

    assert.equal(isReconciled(state, 25), true, 'un total mayor también reconcilia')
  })

  it('el ciclo completo: guardar, esperar, limpiar', () => {
    let state = trackOrder(emptyPending, 20)

    assert.equal(state.count, 1)
    assert.equal(shouldClearNotice(state, 20), false, 'todavía no se proyectó')

    // Llega la señal SSE y el read model ya tiene la orden.
    assert.equal(shouldClearNotice(state, 21), true, 'ya se reconcilió')
  })

  it('con count 0 nunca pide limpiar (evita un loop de renders)', () => {
    assert.equal(shouldClearNotice(emptyPending, 999), false)
    assert.equal(isReconciled(emptyPending, null), true)
  })

  it('sin read model previo usa baseline 0', () => {
    // El 404 NO_STATS deja stats en null: el baseline cae a 0 y la
    // reconciliación compara contra el total absoluto.
    const state = trackOrder(emptyPending, null)

    assert.equal(state.baseline, 0)
    assert.equal(isReconciled(state, 1), true)
    assert.equal(isReconciled(state, 0), false)
  })

  it('varias órdenes seguidas se reconcilian de a una', () => {
    let state = emptyPending

    for (let i = 0; i < 3; i += 1) {
      state = trackOrder(state, 20 + i)
    }

    assert.equal(state.count, 3)
    assert.equal(isReconciled(state, 23), true, 'read model llegó a 20 + 3')
    assert.equal(isReconciled(state, 22), false, 'todavía falta una')
  })
})