import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

/**
 * El seed tiene que ser aritmeticamente verificable sin tocar la base.
 *
 * Si el seed generara precios que no exponen la deriva de float, el total
 * saldria bien por casualida y el acumulador en centavos no estaria
 * probado por nada.
 */

/** Espejo de backend/src/seed/seed.ts. */
const SEED_PRICES: readonly number[] = [
  19.99, 1.15, 1234.56, 0.07, 349.9, 42, 0.29, 3.33, 10.08, 99.95,
  15.5, 7.77, 249.99, 0.01, 88.88, 12.34, 5.6, 150, 67.89, 0.45,
]

const DEFAULT_ORDERS = 20

describe('seed', () => {
  it('los 20 precios por defecto suman 2359.75 exacto', () => {
    const cents = SEED_PRICES.reduce((total, price) => total + Math.round(price * 100), 0)
    assert.equal(cents / 100, 2359.75)
  })

  it('el mismo total acumularia en float con deriva', () => {
    // Este es el motivo del seed: si el total por defecto no depende del
    // pre-calculo en centavos, un bug de aritmetica pasaria desapercibido.
    let float = 0
    for (const price of SEED_PRICES) float += price

    assert.equal(float, 2359.7499999999995)
    assert.notEqual(float, 2359.75)
  })

  it('el seed incluye precios que derivan en float', () => {
    // 1.15 y 1234.56 son los casos que mas exponen el error de arrastre.
    assert.ok(SEED_PRICES.includes(1.15))
    assert.ok(SEED_PRICES.includes(1234.56))
    assert.ok(SEED_PRICES.includes(0.01))
  })

  it('todos los precios son validos segun el schema del command', () => {
    // El seed pasa por handleCreateOrder, asi que un precio invalido
    // fallaria en tiempo de ejecucion y no en este test.
    for (const price of SEED_PRICES) {
      assert.ok(price > 0, `precio no positivo: ${price}`)
      assert.ok(Number.isFinite(price), `precio no finito: ${price}`)
      assert.ok(
        Math.abs(price * 100 - Math.round(price * 100)) < 1e-9,
        `precio con mas de 2 decimales: ${price}`,
      )
    }
  })

  it('el seed cicla los precios y cubre el default completo', () => {
    assert.equal(SEED_PRICES.length, DEFAULT_ORDERS)
  })

  it('el total del seed escala de forma exacta', () => {
    // Con 40 ordenes (dos vueltas) el total debe ser exactamente el doble.
    const onePass = SEED_PRICES.reduce((t, p) => t + Math.round(p * 100), 0)
    const twoPasses = SEED_PRICES.concat(SEED_PRICES).reduce(
      (t, p) => t + Math.round(p * 100),
      0,
    )

    assert.equal(twoPasses / 100, (onePass / 100) * 2)
  })
})
