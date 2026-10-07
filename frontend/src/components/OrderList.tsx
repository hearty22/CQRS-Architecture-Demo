import { formatCents, formatTimestamp } from '../api/contract'
import type { UseOrdersResult } from '../hooks/useOrders'

export interface OrderListProps extends UseOrdersResult {
  /** true si hay una orden guardada que el read model todavía no reflejó. */
  pending: number
}

/**
 * Listado de órdenes del read model.
 *
 * Vista inline, no modal: el dashboard es corto y un modal obligaría a
 * manejar foco, Escape y scroll interno sin aportar nada.
 *
 * `priceCents` viene entero del backend. La conversión a decimales ocurre
 * acá, en el cliente: la capa HTTP no puede hacer aritmética sobre los datos
 * del read model, y hay un test de arquitectura que lo verifica.
 */
export function OrderList({
  rows,
  total,
  loading,
  loadingMore,
  error,
  hasMore,
  loadMore,
  refresh,
  pending,
}: OrderListProps) {
  return (
    <section className="card">
      <header className="list-header">
        <h2>
          Órdenes{' '}
          <span className="list-header__count">
            {loading ? '—' : total}
          </span>
        </h2>
        <button type="button" onClick={refresh} className="button button--ghost">
          Refrescar
        </button>
      </header>

      {pending > 0 && rows.length > 0 && (
        <p className="list-note">
          {pending === 1
            ? '1 orden guardada; puede tardar ~1 s en aparecer.'
            : `${pending} órdenes guardadas; pueden tardar ~1 s en aparecer.`}
        </p>
      )}

      {error !== null && <p className="alert alert--error">{error}</p>}

      {loading && rows.length === 0 && <p className="muted">Cargando órdenes…</p>}

      {!loading && rows.length === 0 && error === null && (
        <p className="muted">
          Todavía no hay órdenes proyectadas. Creá una y aparece sola.
        </p>
      )}

      {rows.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Producto</th>
                <th scope="col" className="table__num">
                  Precio
                </th>
                <th scope="col" className="table__num">
                  Fecha
                </th>
                <th scope="col">Id</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((order) => (
                <tr key={order.id}>
                  <td>{order.productName}</td>
                  <td className="table__num">{formatCents(order.priceCents)}</td>
                  <td className="table__num">{formatTimestamp(order.createdAt)}</td>
                  <td>
                    <code className="table__id">{order.id.slice(0, 8)}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {hasMore && (
        <div className="list-footer">
          <button
            type="button"
            onClick={loadMore}
            disabled={loadingMore}
            className="button button--ghost"
          >
            {loadingMore ? 'Cargando…' : `Cargar más (${rows.length} de ${total})`}
          </button>
        </div>
      )}
    </section>
  )
}