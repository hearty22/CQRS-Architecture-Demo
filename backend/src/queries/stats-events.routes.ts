import { Router } from 'express'
import type { Request, Response } from 'express'

import { STATS_CHANGED_EVENT, statsNotifier } from './stats.notifier.js'
import type { StatsChangedEvent } from './stats.notifier.js'

/**
 * GET /api/stats/events  (Server-Sent Events)
 *
 * Emite una senal cada vez que la proyeccion actualiza el read model. El
 * cliente, al recibirla, revalida contra GET /api/stats.
 *
 * POR QUE NO SE MANDA EL TOTAL POR EL STREAM: el valor emitido por una
 * proyeccion puede quedar obsoleto si otra orden entra un milisegundo
 * despues. Enviando solo "cambio" + revision, el cliente siempre lee la
 * version vigente del read model y nunca muestra un total congelado.
 *
 * Es read path puro: no toca Postgres, no toca Redis, no calcula nada.
 */
export const statsEventsRouter = Router()

const HEARTBEAT_MS = 25_000

statsEventsRouter.get('/', (req: Request, res: Response) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',

    // Sin esto nginx (y algunos proxies) bufferea el stream y los eventos
    // llegan a rafagas cuando se llena el buffer.
    'X-Accel-Buffering': 'no',
  })

  // El evento inicial le dice al cliente que la conexion esta viva y le
  // pasa la revision actual, para que sepa si ya se perdio alguna.
  write(res, 'hello', {
    revision: statsNotifier.currentRevision,
    updatedAt: new Date().toISOString(),
  })

  const onChange = (event: StatsChangedEvent) => {
    write(res, 'stats-changed', event)
  }

  statsNotifier.on(STATS_CHANGED_EVENT, onChange)

  // Commentario-periodico: mantiene viva la conexion a traves de proxies y
  // balanceadores que cierran conexiones ociosas. Sin esto, una pestaña
  // abierta sin actividad vería el stream caerse a los ~60s.
  const heartbeat = setInterval(() => {
    res.write(': keepalive\n\n')
  }, HEARTBEAT_MS)

  /**
   * Cierre en dos partes: primero sacar el listener y el heartbeat, y
   * recien despues terminar la respuesta.
   *
   * Con SSE, si el socket muere y no se saca el listener, cada reconexion
   * deja un listener huerfano. Con muchos usuarios eso es una fuga de
   * memoria que grows sin que nada la delate.
   */
  const cleanup = () => {
    clearInterval(heartbeat)
    statsNotifier.off(STATS_CHANGED_EVENT, onChange)
  }

  req.on('close', () => {
    cleanup()
    res.end()
  })
})

function write(res: Response, event: string, data: unknown): void {
  // El `id` permite que EventSource envia Last-Event-ID al reconectar, y
  // el `data` tiene que partirse por lineas: un salto de linea crudo
  // romperia el formato del stream.
  const payload = JSON.stringify(data)
    .split('\n')
    .map((line) => `data: ${line}`)
    .join('\n')

  res.write(`event: ${event}\n${payload}\n\n`)
}