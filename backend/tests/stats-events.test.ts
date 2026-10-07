import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { STATS_CHANGED_EVENT, StatsNotifier } from '../src/queries/stats.notifier.js'

/**
 * El notifier es la pieza que hace que SSE no mienta.
 *
 * Si se emitiera antes de aplicar la proyeccion, el cliente revalidaria y
 * veria el total viejo. Y si llevara el importe, podria congelar en
 * pantalla un valor obsoleto.
 */

describe('contrato del payload SSE', () => {
  const notifier = new StatsNotifier()

  it('lleva revision, updatedAt y reason', () => {
    const received: Record<string, unknown>[] = []
    notifier.on(STATS_CHANGED_EVENT, (event) => received.push(event))

    notifier.notify('order:evt-1')

    const payload = received[0]
    assert.ok(payload)
    assert.equal(typeof payload.revision, 'number')
    assert.equal(typeof payload.updatedAt, 'string')
    assert.equal(payload.reason, 'order:evt-1')
  })

  it('NO lleva el importe del read model', () => {
    // El total emitido puede quedar obsoleto si otra orden entra un
    // milisegundo despues. El cliente tiene que revalidar contra el read
    // model, nunca confiar en el valor del stream.
    const received: Record<string, unknown>[] = []
    notifier.on(STATS_CHANGED_EVENT, (event) => received.push(event))

    notifier.notify('order:evt-2')

    const payload = received[0] ?? {}
    assert.equal('totalRevenue' in payload, false)
    assert.equal('totalOrders' in payload, false)
    assert.equal('data' in payload, false)
  })

  it('el payload es JSON-serializable (el stream lo tiene que poder emitir)', () => {
    const event = notifier.notify('order:evt-3')

    assert.deepEqual(JSON.parse(JSON.stringify(event)), event)
  })
})

describe('estado del notifier', () => {
  it('la revision arranca en 0 antes de cualquier cambio', () => {
    // Es el valor que el endpoint manda en el evento hello, para que un
    // cliente que se reconecta sepa si se perdio alguna señal.
    assert.equal(new StatsNotifier().currentRevision, 0)
  })

  it('la revision se incrementa en cada notify', () => {
    const notifier = new StatsNotifier()

    assert.equal(notifier.currentRevision, 0)
    notifier.notify('a')
    assert.equal(notifier.currentRevision, 1)
    notifier.notify('b')
    assert.equal(notifier.currentRevision, 2)
  })

  it('notificar sin listeners no tira', () => {
    // El worker puede notificar antes de que haya un cliente SSE
    // conectado; si eso rompiera el proceso, perderiamos la proyeccion.
    assert.doesNotThrow(() => new StatsNotifier().notify('sin-clientes'))
  })

  it('no tiene limite de listeners (varias pestanas abiertas)', () => {
    // El default de EventEmitter es 10; con mas pestanas Emite
    // MaxListenersExceededWarning sin motivo real.
    assert.equal(new StatsNotifier().getMaxListeners(), 0)
  })

  it('cada listener recibe su propia copia y puede desuscribirse', () => {
    const notifier = new StatsNotifier()
    const first: unknown[] = []
    const second: unknown[] = []

    const onFirst = (event: unknown) => first.push(event)
    notifier.on(STATS_CHANGED_EVENT, onFirst)
    notifier.on(STATS_CHANGED_EVENT, (event: unknown) => second.push(event))

    notifier.notify('x')
    notifier.off(STATS_CHANGED_EVENT, onFirst)
    notifier.notify('y')

    assert.equal(first.length, 1, 'el listener dado de baja no recibe mas')
    assert.equal(second.length, 2)
  })
})

describe('formato del stream SSE', () => {
  /** Replica la funcion write() de stats-events.routes.ts. */
  const write = (event: string, data: unknown): string => {
    const payload = JSON.stringify(data)
      .split('\n')
      .map((line) => `data: ${line}`)
      .join('\n')

    return `event: ${event}\n${payload}\n\n`
  }

  it('emite event: y data: y termina en linea en blanco', () => {
    const frame = write('stats-changed', { revision: 1 })

    assert.match(frame, /^event: stats-changed\n/)
    assert.match(frame, /\ndata: \{/)
    assert.ok(frame.endsWith('\n\n'), 'el frame debe terminar en linea en blanco')
  })

  it('un salto de linea en el valor NO rompe el stream', () => {
    // JSON.stringify escapa el \n como dos caracteres, asi que el payload
    // sigue siendo una sola linea data:. El split() de write() es la red
    // de seguridad para cuando el payload NO venga de JSON.
    const frame = write('stats-changed', { reason: 'a\nb' })
    const dataLines = frame.split('\n').filter((line) => line.startsWith('data: '))

    assert.equal(dataLines.length, 1, 'JSON.stringify ya escapo el salto de linea')
    assert.deepEqual(JSON.parse(dataLines[0]!.slice(6)), { reason: 'a\nb' })
  })

  it('parte en varias lineas data: si el payload trae un salto crudo', () => {
    // Path defensivo: si algun dia el payload llega como texto sin
    // JSON.stringify, el split evita romper el formato del stream.
    const crudo = 'linea1\nlinea2'
    const payload = crudo
      .split('\n')
      .map((line) => `data: ${line}`)
      .join('\n')

    assert.equal(payload.split('\n').filter((l) => l.startsWith('data: ')).length, 2)
  })

  it('el evento hello lleva la revision actual', () => {
    const frame = write('hello', { revision: 7, updatedAt: 'x' })

    assert.match(frame, /^event: hello\n/)
    assert.match(frame, /"revision":7/)
  })
})