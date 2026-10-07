import type { StatsSignal, StreamState } from '../hooks/useStats'

const LABELS: Record<StreamState, string> = {
  connecting: 'conectando',
  live: 'en vivo',
  polling: 'respaldo por polling',
  offline: 'sin conexión',
}

/**
 * Muestra como esta llegando la actualización del read model.
 *
 * No es decorativo: la consistencia eventual es invisible para el usuario
 * si no se le dice que el total puede tardar. Sin esto, "guardé una orden y
 * el total no cambió" se lee como un bug.
 *
 * El punto pulsa con cada señal recibida: prueba visual de que el stream
 * está vivo, no solo de que la conexión está abierta.
 */
export function StreamBadge({
  state,
  signal,
}: {
  state: StreamState
  signal?: StatsSignal | null
}) {
  return (
    <span className={`badge badge--${state}`}>
      <span
        key={signal?.revision ?? 'idle'}
        className="badge__dot badge__dot--pulse"
        aria-hidden="true"
      />
      {LABELS[state]}
    </span>
  )
}