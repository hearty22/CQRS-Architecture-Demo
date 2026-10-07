/**
 * Cuenta de órdenes guardadas que el read model todavía no reflejó.
 *
 * Vive aparte de React a propósito: es lógica de estado con ciclo de vida
 * (aparece al guardar, se reconcilia cuando llega la proyección) y poder
 * testearla sin montar un componente es lo que evita que el contador se
 * quede trabado para siempre.
 */

export interface PendingState {
  /** Cuántas órdenes esperamos que aparezcan en el read model. */
  count: number
  /** totalOrders del read model en el momento de la primera espera. */
  baseline: number | null
}

export const emptyPending: PendingState = { count: 0, baseline: null }

/**
 * Registra una orden guardada.
 *
 * El baseline se captura en la PRIMERA espera, no en cada alta: si se
 * capturara en cada una, `baseline` avanzaría junto con el read model y la
 * condición de reconciliación nunca se cumpliría.
 */
export function trackOrder(
  state: PendingState,
  currentTotalOrders: number | null,
): PendingState {
  return {
    count: state.count + 1,
    baseline: state.baseline ?? currentTotalOrders ?? 0,
  }
}

/**
 * ¿Ya reflejó el read model todo lo que esperamos?
 *
 * Compara contra `totalOrders`, que es monótono. Si el read model ya
 * llegó a `baseline + count`, todas las órdenes guardadas están
 * proyectadas y el aviso puede desaparecer.
 */
export function isReconciled(
  state: PendingState,
  currentTotalOrders: number | null,
): boolean {
  if (state.count === 0) return true
  if (currentTotalOrders === null) return false

  // `baseline` solo puede ser null cuando count es 0 (ver trackOrder), y
  // eso ya se resolvió arriba. El ?? 0 es defensivo, no una decisión.
  return currentTotalOrders >= (state.baseline ?? 0) + state.count
}

/**
 * ¿Corresponde limpiar el aviso con este total del read model?
 *
 * El hook dispara `refresh` por varias razones (conexión, polling de
 * respaldo, señal SSE). Reconciliar solo cuando el read model efectivamente
 * alcanzó el total esperado evita que el aviso desaparezca antes de tiempo.
 */
export function shouldClearNotice(
  state: PendingState,
  currentTotalOrders: number | null,
): boolean {
  return state.count > 0 && isReconciled(state, currentTotalOrders)
}