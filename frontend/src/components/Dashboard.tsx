import type { DashboardStats } from '../api/contract'
import { formatAge, formatRevenue } from '../api/contract'
import { StreamBadge } from './StreamBadge'
import type { StreamState } from '../hooks/useStats'

export interface DashboardProps {
  stats: DashboardStats | null
  empty: boolean
  loading: boolean
  error: string | null
  streamState: StreamState
  /** Órdenes guardadas que el read model todavía no reflejó. */
  pending: number
  onRefresh: () => void
}

export function Dashboard({
  stats,
  empty,
  loading,
  error,
  streamState,
  pending,
  onRefresh,
}: DashboardProps) {
  if (loading && stats === null) {
    return <p className="muted">Cargando read model…</p>
  }

  return (
    <section className="stack">
      <div className="toolbar">
        <StreamBadge state={streamState} />
        <button type="button" onClick={onRefresh} className="button button--ghost">
          Refrescar
        </button>
      </div>

      {error !== null && <p className="alert alert--error">{error}</p>}

      {pending > 0 && (
        <p className="alert alert--pending">
          {pending === 1
            ? '1 orden guardada. El total se actualiza cuando la proyección corre.'
            : `${pending} órdenes guardadas. El total se actualiza cuando la proyección corre.`}
        </p>
      )}

      {empty && (
        <div className="card">
          <h2>Todavía no hay datos</h2>
          <p className="muted">
            El read model se construye a partir de los eventos. Creá la primera orden y el
            dashboard se completa solo.
          </p>
        </div>
      )}

      {stats !== null && (
        <>
          <div className="metrics">
            <article className="metric">
              <span className="metric__label">Facturación total</span>
              <strong className="metric__value">{formatRevenue(stats.totalRevenue)}</strong>
            </article>

            <article className="metric">
              <span className="metric__label">Órdenes</span>
              <strong className="metric__value">{stats.totalOrders}</strong>
            </article>
          </div>

          <p className="muted small">
            Proyectado {formatAge(stats.updatedAt)} ·{' '}
            <code>GET /api/stats</code>
          </p>
        </>
      )}
    </section>
  )
}