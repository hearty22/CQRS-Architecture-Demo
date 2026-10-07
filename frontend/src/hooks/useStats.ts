import { useCallback, useEffect, useRef, useState } from 'react'

import type { DashboardStats } from '../api/contract'
import { fetchStats } from '../api/client'

/**
 * Carga el read model y se suscribe a las senales de SSE.
 *
 * SSE es la via principal. El polling es el RESPALDO: sin el, si el stream
 * se corta (reinicio del backend, corte de red, proxy que cierra la
 * conexion ociosa) el dashboard queda congelado sin explicacion y parece
 * roto.
 */

export type StreamState = 'connecting' | 'live' | 'polling' | 'offline'

export interface UseStatsResult {
  stats: DashboardStats | null
  empty: boolean
  loading: boolean
  error: string | null
  streamState: StreamState
  refresh: () => void
}

/** Cada cuanto revalida el respaldo, si el stream no esta vivo. */
const POLL_MS = 5_000

/** Cada cuanto revalida aunque el stream este sano, para compensar perdidas. */
const REFRESH_MS = 30_000

export function useStats(): UseStatsResult {
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [empty, setEmpty] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [streamState, setStreamState] = useState<StreamState>('connecting')

  // Guardado en un ref para que los listeners de SSE no se re-creen en cada
  // render y no dejen suscripciones huerfanas.
  const lastRevision = useRef(-1)

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const result = await fetchStats(signal)

      setStats(result.stats)
      setEmpty(result.empty)
      setError(null)
    } catch (caught) {
      if (signal?.aborted) return

      setError(caught instanceof Error ? caught.message : 'no se pudo leer /api/stats')
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [])

  const refresh = useCallback(() => {
    void load()
  }, [load])

  // Carga inicial.
  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)

    return () => {
      controller.abort()
    }
  }, [load])

  // Suscripcion SSE.
  useEffect(() => {
    // EventSource reconecta solo, asi que no hay que manejar backoff aca.
    // El unico riesgo es que se reconecte en loop si el backend esta caido;
    // por eso el polling de respaldo queda siempre activo.
    const source = new EventSource('/api/stats/events')

    source.addEventListener('hello', (event) => {
      const revision = readRevision(event)
      if (revision !== null) lastRevision.current = revision
      setStreamState('live')
    })

    source.addEventListener('stats-changed', (event) => {
      const revision = readRevision(event)

      // Descarta senales repetidas: una reconexion puede reenviar la
      // ultima y no tiene sentido revalidar dos veces por el mismo cambio.
      if (revision !== null && revision <= lastRevision.current) return
      if (revision !== null) lastRevision.current = revision

      setStreamState('live')
      void load()
    })

    source.onerror = () => {
      // EventSource sigue reconectando por su cuenta. Solo se marca el
      // estado para que la UI pueda avisar que esta en modo respaldo.
      setStreamState('polling')
    }

    return () => {
      source.close()
    }
  }, [load])

  // Respaldo por polling: corre siempre, no solo cuando el stream cae.
  // Cuesta un GET cada 5s y compra que el dashboard nunca quede congelado.
  useEffect(() => {
    const id = setInterval(() => {
      void load()
    }, POLL_MS)

    return () => {
      clearInterval(id)
    }
  }, [load])

  // Revalidacion periodica aunque el stream este sano: una senal perdida
  // (evento descartado por red) no se puede detectar del lado del cliente.
  useEffect(() => {
    const id = setInterval(() => {
      void load()
    }, REFRESH_MS)

    return () => {
      clearInterval(id)
    }
  }, [load])

  useEffect(() => {
    if (streamState === 'connecting') setStreamState('polling')
  }, [streamState])

  return { stats, empty, loading, error, streamState, refresh }
}

function readRevision(event: Event): number | null {
  const data = (event as MessageEvent).data

  if (typeof data !== 'string') return null

  try {
    const parsed: unknown = JSON.parse(data)

    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'revision' in parsed &&
      typeof (parsed as { revision: unknown }).revision === 'number'
    ) {
      return (parsed as { revision: number }).revision
    }
  } catch {
    // Un payload malformado no debe romper la suscripcion.
  }

  return null
}