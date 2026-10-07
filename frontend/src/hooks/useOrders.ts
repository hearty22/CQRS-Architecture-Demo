import { useCallback, useEffect, useRef, useState } from 'react'

import type { OrderPage, OrderRow } from '../api/contract'
import { fetchOrders } from '../api/client'

/**
 * Listado de órdenes del read model, paginado por cursor.
 *
 * Las páginas previas se conservan en memoria y se concatenan: el cursor
 * sigue siendo el mecanismo de paginación en el servidor, pero el usuario ve
 * una sola lista creciente en lugar de una lista de 20 filas con botones.
 */

const PAGE_SIZE = 20

export interface UseOrdersResult {
  rows: OrderRow[]
  total: number
  loading: boolean
  loadingMore: boolean
  error: string | null
  hasMore: boolean
  loadMore: () => void
  refresh: () => void
}

export function useOrders(): UseOrdersResult {
  const [page, setPage] = useState<OrderPage | null>(null)
  const [rows, setRows] = useState<OrderRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Espejo del cursor: permite recargar más sin depender del closure de
  // `page`, que cambiaría en cada render.
  const cursorRef = useRef<string | null>(null)

  const load = useCallback(
    async (cursor: string | null, mode: 'replace' | 'append', signal?: AbortSignal) => {
      try {
        const result = await fetchOrders({ cursor, limit: PAGE_SIZE }, signal)

        if (mode === 'replace') {
          setRows(result?.rows ?? [])
          setPage(result)
          cursorRef.current = result?.nextCursor ?? null
        } else if (result) {
          setRows((current) => [...current, ...result.rows])
          cursorRef.current = result.nextCursor
        }

        setError(null)
      } catch (caught) {
        if (signal?.aborted) return
        setError(caught instanceof Error ? caught.message : 'no se pudo leer /api/orders')
      } finally {
        if (!signal?.aborted) {
          setLoading(false)
          setLoadingMore(false)
        }
      }
    },
    [],
  )

  useEffect(() => {
    const controller = new AbortController()
    void load(null, 'replace', controller.signal)

    return () => {
      controller.abort()
    }
  }, [load])

  const loadMore = useCallback(() => {
    const cursor = cursorRef.current
    if (cursor === null) return

    setLoadingMore(true)
    void load(cursor, 'append')
  }, [load])

  const refresh = useCallback(() => {
    setLoading(true)
    void load(null, 'replace')
  }, [load])

  return {
    rows,
    total: page?.total ?? rows.length,
    loading,
    loadingMore,
    error,
    hasMore: cursorRef.current !== null,
    loadMore,
    refresh,
  }
}