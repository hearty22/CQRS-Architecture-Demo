import type { SignalRecord } from '../hooks/useStats'

/**
 * Registro de señales de proyección recibidas por SSE.
 *
 * Es la ventana a la arquitectura: cada fila es un evento que ya aplicó el
 * worker al read model. Sin datos de red ni consola, se ve el flujo
 * Postgres → Redis → proyección → Mongo a través de los `model`.
 */
export function EventFeed({ events }: { events: SignalRecord[] }) {
  return (
    <section className="card">
      <header className="list-header">
        <h2>
          Eventos proyectados{' '}
          <span className="list-header__count">{events.length}</span>
        </h2>
      </header>

      {events.length === 0 ? (
        <p className="muted">Todavía no llegó ninguna señal. Creá una orden y aparece sola.</p>
      ) : (
        <ul className="event-feed">
          {events.map((event) => (
            <li key={event.revision} className="event-feed__item">
              <code>#{event.revision}</code>{' '}
              <span className={`event-feed__model event-feed__model--${event.model}`}>
                {event.model}
              </span>
              <span className="muted small">{formatTime(event.receivedAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('es-AR', { hour12: false })
}
