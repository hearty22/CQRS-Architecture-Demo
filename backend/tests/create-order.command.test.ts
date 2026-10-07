import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { createOrderSchema } from '../src/commands/orders/create-order.command.js'

/**
 * El punto flotante hace que 19.99 * 100 === 1998.9999999999998. Una
 * validacion ingenua con Number.isInteger rechaza precios legitimos; una
 * sin epsilon de tolerancia deja pasar 10.999. Estos tests fijan el
 * comportamiento en los dos extremos.
 */
describe('createOrderSchema', () => {
  const parse = (body: unknown) => createOrderSchema.safeParse(body)

  it('acepta un precio de 2 decimales', () => {
    const result = parse({ productName: 'Teclado', price: 19.99 })
    assert.equal(result.success, true)
  })

  it('acepta un precio entero', () => {
    assert.equal(parse({ productName: 'Mouse', price: 42 }).success, true)
  })

  it('rechaza 3 decimales en vez de redondear', () => {
    const result = parse({ productName: 'X', price: 10.999 })
    assert.equal(result.success, false)
    assert.match(result.error?.issues[0]?.message ?? '', /2 decimales/)
  })

  it('rechaza un precio negativo', () => {
    assert.equal(parse({ productName: 'X', price: -5 }).success, false)
  })

  it('rechaza cero', () => {
    assert.equal(parse({ productName: 'X', price: 0 }).success, false)
  })

  it('rechaza NaN e Infinity', () => {
    assert.equal(parse({ productName: 'X', price: 'NaN' }).success, false)
    assert.equal(parse({ productName: 'X', price: 'Infinity' }).success, false)
  })

  it('coercea un string numerico', () => {
    const result = parse({ productName: 'Monitor', price: '149.50' })
    assert.equal(result.success, true)
    assert.equal(result.data?.price, 149.5)
  })

  it('hace trim de productName y rechaza el vacio', () => {
    assert.equal(parse({ productName: '   ', price: 10 }).success, false)
    assert.equal(parse({ productName: '  Teclado  ', price: 10 }).data?.productName, 'Teclado')
  })

  it('rechaza productName de mas de 255 caracteres', () => {
    assert.equal(parse({ productName: 'a'.repeat(256), price: 10 }).success, false)
    assert.equal(parse({ productName: 'a'.repeat(255), price: 10 }).success, true)
  })

  it('rechaza campos faltantes', () => {
    assert.equal(parse({}).success, false)
    assert.equal(parse({ price: 10 }).success, false)
    assert.equal(parse({ productName: 'X' }).success, false)
  })
})
