/**
 * Verificacion del contrato SSE en vivo contra el backend real.
 *
 * Corre como script, no como test: necesita el stack docker-compose
 * levantado. Cubre lo que un test unitario NO puede probar — que el stream
 * llegue de verdad por el proxy y que la señal salga despues de aplicar la
 * proyeccion.
 *
 * Uso:
 *   docker compose up -d
 *   pnpm test:sse
 */

import assert from 'node:assert/strict'

const BASE = process.env.SSE_BASE_URL ?? 'http://localhost:5173'
const ORDERS = `${BASE}/api/orders`
const EVENTS = `${BASE}/api/stats/events`
const STATS = `${BASE}/api/stats`

const TIMEOUT_MS = 25_000

interface StatsBody {
  data?: { totalRevenue: number; totalOrders: number; updatedAt: string }
}

/** Cuenta los eventos de un tipo hasta que se cumpla la condicion. */
async function waitForEvent(
  type: string,
  predicate: (payload: Record<string, unknown>) => boolean,
): Promise<Record<string, unknown>> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const response = await fetch(EVENTS, {
      signal: controller.signal,
      headers: { accept: 'text/event-stream' },
    })

    assert.equal(response.status, 200, 'el endpoint debe responder 200')
    assert.match(
      response.headers.get('content-type') ?? '',
      /text\/event-stream/,
      'debe declarar text/event-stream',
    )

    const body = response.body
    assert.ok(body, 'SSE necesita body como stream')

    const decoder = new TextDecoder()
    const reader = body.getReader()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      // Un frame SSE termina en linea en blanco.
      let split = buffer.indexOf('\n\n')
      while (split !== -1) {
        const frame = buffer.slice(0, split)
        buffer = buffer.slice(split + 2)

        const eventType = frame.match(/^event: (.+)$/m)?.[1]
        const dataLines = frame
          .split('\n')
          .filter((line) => line.startsWith('data: '))
          .map((line) => line.slice(6))

        if (eventType === type && dataLines.length > 0) {
          const payload = JSON.parse(dataLines.join('\n')) as Record<string, unknown>
          if (predicate(payload)) {
            controller.abort()
            return payload
          }
        }

        split = buffer.indexOf('\n\n')
      }
    }

    throw new Error(`el stream termino sin un evento "${type}" que cumpliera la condicion`)
  } finally {
    clearTimeout(timer)
  }
}

async function getStats(): Promise<StatsBody> {
  const response = await fetch(STATS, { headers: { accept: 'application/json' } })
  return (await response.json()) as StatsBody
}

async function main(): Promise<void> {
  console.log(`verificando SSE contra ${BASE}`)

  const before = await getStats()
  assert.ok(before.data, 'el read model deberia existir; corré el seed primero')

  const price = 12.34
  const productName = `SSE check ${Date.now()}`

  const hello = await waitForEvent('hello', () => true)
  const revisionBefore = hello.revision
  console.log(`  hello recibido, revision ${String(revisionBefore)}`)

  // El POST devuelve 201; el read model todavia no cambio.
  const created = await fetch(ORDERS, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ productName, price }),
  })

  assert.equal(created.status, 201, 'el POST debe devolver 201')

  const immediately = await getStats()
  const jumpedBeforeProjection =
    immediately.data?.totalOrders !== before.data?.totalOrders

  if (jumpedBeforeProjection) {
    console.log('  nota: la proyeccion aplico antes del chequeo (relay rapido)')
  } else {
    console.log('  el read model todavia no cambio tras el 201 (consistencia eventual)')
  }

  // La señal debe traer una revision MAYOR a la del hello.
  const signal = await waitForEvent('stats-changed', () => true)
  const revisionAfter = signal.revision as number

  assert.ok(
    revisionAfter > (revisionBefore as number),
    `la revision tiene que avanzar: ${String(revisionBefore)} -> ${String(revisionAfter)}`,
  )
  console.log(`  señal recibida, revision ${String(revisionAfter)}`)

  // Y lo importante: la señal NO debe llevar el importe.
  assert.equal('totalRevenue' in signal, false, 'el stream no debe llevar el importe')
  assert.equal('totalOrders' in signal, false, 'el stream no debe llevar los contadores')
  console.log('  la señal no lleva el importe (el cliente revalida)')

  // Tras la señal, el read model tiene que reflejar la orden.
  const after = await getStats()
  assert.ok(after.data, 'el read model deberia seguir existiendo')
  assert.equal(
    after.data?.totalOrders,
    (before.data?.totalOrders ?? 0) + 1,
    'la proyección tiene que haber aplicado exactamente una vez',
  )

  const expectedRevenue = Number(((before.data?.totalRevenue ?? 0) + price).toFixed(2))
  assert.equal(after.data?.totalRevenue, expectedRevenue, 'el importe tiene que cuadrar')

  console.log(
    `  read model: ${String(before.data?.totalOrders)} -> ${String(after.data?.totalOrders)} ordenes, ` +
      `$${String(before.data?.totalRevenue)} -> $${String(after.data?.totalRevenue)}`,
  )

  console.log('\nOK: SSE funciona end-to-end')
}

main().catch((error: unknown) => {
  console.error('\nFALLO:', error instanceof Error ? error.message : error)
  process.exitCode = 1
})