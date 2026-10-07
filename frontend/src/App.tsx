import { useCallback, useEffect, useState } from 'react'

import type { CreatedOrder } from './api/contract'
import { CreateOrderForm } from './components/CreateOrderForm'
import { Dashboard } from './components/Dashboard'
import { OrderList } from './components/OrderList'
import { emptyPending, shouldClearNotice, trackOrder } from './state/pending'
import { useOrders } from './hooks/useOrders'
import { useStats } from './hooks/useStats'

type Tab = 'dashboard' | 'crear'

export function App() {
  const [tab, setTab] = useState<Tab>('dashboard')
  const [pending, setPending] = useState(emptyPending)
  const [lastOrder, setLastOrder] = useState<CreatedOrder | null>(null)

  const { stats, empty, loading, error, streamState, lastSignal, refresh } = useStats()
  const orders = useOrders()

  /**
   * Al guardar se incrementa el contador y NO se refresca a mano: el read
   * model todavía no cambió. El total sube solo cuando la proyección
   * aplica, que el hook detecta por SSE.
   *
   * Refrescar en el acto mostraría el mismo número de antes y daría la
   * impresión de que el guardado no funcionó.
   */
  const handleCreated = useCallback(
    (order: CreatedOrder) => {
      setLastOrder(order)
      setPending((state) => trackOrder(state, stats?.totalOrders ?? null))
      setTab('dashboard')
    },
    [stats?.totalOrders],
  )

  /**
   * El aviso se limpia SOLO cuando el read model alcanzó el total
   * esperado. Sin esto el contador sube y nunca baja, y el banner queda
   * diciendo "1 orden guardada" para siempre.
   */
  useEffect(() => {
    if (shouldClearNotice(pending, stats?.totalOrders ?? null)) {
      setPending(emptyPending)
    }
  }, [pending, stats?.totalOrders])

  /*
   * El listado se recarga cuando llega una senal SSE del modelo `orders`,
   * para que la orden recien guardada aparezca arriba sin refrescar a mano.
   */
  useEffect(() => {
    if (lastSignal?.model === 'orders') {
      orders.refresh()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastSignal])

  /*
   * Respaldo coherente con useStats: si el stream esta caido no llegan
   * senales, asi que la lista se revalida por polling igual que las
   * metricas. Sin esto el badge diria "respaldo por polling" pero la
   * tabla quedaria congelada.
   */
  useEffect(() => {
    if (streamState !== 'polling' && streamState !== 'offline') return

    const id = setInterval(() => {
      orders.refresh()
    }, 5_000)

    return () => {
      clearInterval(id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamState])

  return (
    <main className="page">
      <header className="header">
        <div>
          <h1>CQRS · Orders</h1>
          <p className="muted">Escritura en PostgreSQL · lectura en MongoDB · bus en Redis</p>
        </div>

        <nav className="tabs">
          <button
            type="button"
            className={tab === 'dashboard' ? 'tab tab--active' : 'tab'}
            onClick={() => setTab('dashboard')}
          >
            Dashboard
          </button>
          <button
            type="button"
            className={tab === 'crear' ? 'tab tab--active' : 'tab'}
            onClick={() => setTab('crear')}
          >
            Crear orden
          </button>
        </nav>
      </header>

      {tab === 'dashboard' ? (
        <div className="stack">
          <Dashboard
            stats={stats}
            empty={empty}
            loading={loading}
            error={error}
            streamState={streamState}
            pending={pending.count}
            onRefresh={refresh}
          />

          {/* El listado se refresca junto con las métricas: ambas leen del
              mismo read model y la señal SSE cubre las dos. */}
          <OrderList {...orders} pending={pending.count} />
        </div>
      ) : (
        <CreateOrderForm onCreated={handleCreated} />
      )}

      {lastOrder !== null && (
        <footer className="card card--muted">
          <p className="muted small">
            Última orden: <strong>{lastOrder.productName}</strong> · ${lastOrder.price} ·{' '}
            <code>{lastOrder.id.slice(0, 8)}</code>
          </p>
        </footer>
      )}
    </main>
  )
}