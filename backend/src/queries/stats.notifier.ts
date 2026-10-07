import { EventEmitter } from 'node:events'

/**
 * Bus de notificaciones en memoria.
 *
 * Existe UNA fuente de verdad para "el read model cambio": la proyeccion.
 * Notificar desde el handler del POST estaria mal, porque el POST responde
 * 201 antes de que el evento exista en Redis; el dashboard se refrescaria
 * y mostraria el total viejo.
 *
 * Solo lleva la senal, NUNCA el importe: el total que emite la proyeccion
 * puede quedar obsoleto si otra orden entra un milisegundo despues. El
 * cliente revalida contra el read model.
 *
 * LIMITACION CONOCIDA: es local al proceso. Funciona porque el worker vive
 * dentro del backend (RUN_WORKER). Si se separa a otro contenedor, este
 * emitter no cruza containers y hay que reemplazarlo por el bus de Redis.
 */

export interface StatsChangedEvent {
  /** Incremental en cada cambio. El cliente lo usa para descartar señales repetidas. */
  revision: number
  /** Cuándo se aplico el cambio. No es el total: solo la marca temporal. */
  updatedAt: string
  /** Que evento la disparo. Util para debuggear sin ir al log. */
  reason: string
  /**
   * Qué read model cambió. El cliente revalida solo lo que le importa: una
   * señal de `orders` no tiene por qué disparar un fetch de `/api/stats`.
   */
  model: ReadModelName
}

/** Read models que pueden emitir señales. */
export const READ_MODELS = ['stats', 'orders'] as const

export type ReadModelName = (typeof READ_MODELS)[number]

/** Nombre del evento interno. No viaja por el stream (allá es 'stats-changed'). */
export const STATS_CHANGED_EVENT = 'stats-changed'

export class StatsNotifier extends EventEmitter {
  private revision = 0

  constructor() {
    super()
    // En el constructor, NO dentro de notify(): ponerlo en notify
    // significa que el limite solo se levanta despues del primer cambio,
    // y con 11 pestanas abiertas el EventEmitter ya habria emitted
    // MaxListenersExceededWarning.
    this.setMaxListeners(0)
  }

  /** Ultima revision emitida. Permite reconectar sin perder el estado. */
  get currentRevision(): number {
    return this.revision
  }

  notify(
    reason: string,
    model: ReadModelName = 'stats',
    updatedAt: Date = new Date(),
  ): StatsChangedEvent {
    this.revision += 1

    const event: StatsChangedEvent = {
      revision: this.revision,
      updatedAt: updatedAt.toISOString(),
      reason,
      model,
    }

    this.emit(STATS_CHANGED_EVENT, event)

    return event
  }
}

export const statsNotifier = new StatsNotifier()