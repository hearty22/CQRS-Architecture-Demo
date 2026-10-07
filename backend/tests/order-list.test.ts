import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  clampLimit,
  decodeCursor,
  encodeCursor,
} from '../src/queries/orders/order.read-model.js'

/**
 * La paginación por cursor tiene una trampa clásica: `createdAt` solo no
 * alcanza como posición, porque varias órdenes pueden compartir milisegundo.
 * Sin desempatar por `_id`, la página 2 puede repetir la última fila de la
 * página 1 o saltar una.
 */

describe('cursor de paginación', () => {
  const createdAt = new Date('2026-10-07T14:00:00.000Z')

  it('codifica y decodifica sin perder datos', () => {
    const cursor = encodeCursor(createdAt, 'ord-123')
    const decoded = decodeCursor(cursor)

    assert.ok(decoded)
    assert.equal(decoded.id, 'ord-123')
    assert.equal(decoded.createdAt.toISOString(), createdAt.toISOString())
  })

  it('el cursor es opaco (base64url, sin caracteres problemáticos)', () => {
    const cursor = encodeCursor(createdAt, 'ord-123')

    assert.match(cursor, /^[A-Za-z0-9_-]+$/, 'debe ser seguro en query string')
    assert.doesNotMatch(cursor, /[+/=]/, 'base64 estándar rompería la URL')
  })

  it('el _id sobrevive aunque tenga el separador', () => {
    // El separador es '|': si el id lo contuviera, un parseo ingenuo con
    // indexOf cortaría el id. Por eso se usa lastIndexOf.
    const cursor = encodeCursor(createdAt, 'weird|id|value')
    const decoded = decodeCursor(cursor)

    assert.equal(decoded?.id, 'weird|id|value')
  })

  it('rechaza cursores corruptos sin tirar excepción', () => {
    // Cualquier basura que no sea el JSON esperado devuelve null en vez de
    // propagar la excepción: un cursor corrupto es un query param inválido,
    // no un 500.
    assert.equal(decodeCursor(Buffer.from('no soy json', 'utf8').toString('base64url')), null)
    assert.equal(decodeCursor(''), null)
    assert.equal(decodeCursor(Buffer.from('{}', 'utf8').toString('base64url')), null)
    assert.equal(decodeCursor(Buffer.from('[]', 'utf8').toString('base64url')), null)
  })

  it('rechaza una fecha inválida', () => {
    const cursor = Buffer.from('no-es-fecha|ord-1', 'utf8').toString('base64url')
    assert.equal(decodeCursor(cursor), null)
  })

  it('dos órdenes del mismo milisegundo tienen cursores distintos', () => {
    // Este es el caso que obliga a desempatar por _id: sin cursores
    // distintos, la segunda caería en la misma página que la primera.
    const a = encodeCursor(createdAt, 'ord-A')
    const b = encodeCursor(createdAt, 'ord-B')

    assert.notEqual(a, b)
  })
})

describe('clampLimit', () => {
  it('usa el default cuando no hay valor', () => {
    assert.equal(clampLimit(undefined), DEFAULT_LIMIT)
    assert.equal(clampLimit(Number.NaN), DEFAULT_LIMIT)
    assert.equal(clampLimit(Number.POSITIVE_INFINITY), DEFAULT_LIMIT)
  })

  it('acota el máximo', () => {
    assert.equal(clampLimit(1000), MAX_LIMIT)
  })

  it('nunca devuelve menos de 1', () => {
    assert.equal(clampLimit(0), 1)
    assert.equal(clampLimit(-5), 1)
  })

  it('trunca decimales', () => {
    assert.equal(clampLimit(10.7), 10)
  })

  it('respeta un valor válido', () => {
    assert.equal(clampLimit(50), 50)
  })
})