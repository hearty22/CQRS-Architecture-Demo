import type { StreamState } from '../hooks/useStats'

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
 */
export function StreamBadge({ state }: { state: StreamState }) {
  return (
    <span className={`badge badge--${state}`}>
      <span className="badge__dot" aria-hidden="true" />
      {LABELS[state]}
    </span>
  )
}