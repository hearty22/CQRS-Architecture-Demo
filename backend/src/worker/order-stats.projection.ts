import type { OrderCreatedPayload } from '../shared/channels.js'
import { DASHBOARD_STATS_ID, DashboardStats } from '../queries/dashboard-stats.model.js'
import { parseOrderCreatedPayload } from '../shared/channels.js'

export interface ApplyResult {
  applied: boolean
  reason?: 'already-processed' | 'invalid-payload'
}

/**
 * Aplica un ORDER_CREATED al read model de estadisticas.
 *
 * IDEMPOTENCIA: el filtro incluye `processedEventIds: { $ne: eventId }`. Si
 * el evento ya se aplico, el filtro no matchea, MongoDB no toca el documento
 * y matchedCount queda en 0. Por eso la operacion es una sola y atomica.
 *
 * Por que NO se usa un ledger aparte en otra coleccion: insert + $inc serian
 * DOS operaciones, y MongoDB standalone no soporta transacciones multi
 * documento. Quedaria una ventana en la que el evento queda marcado como
 * visto pero nunca se suma. Aca no hay ventana: todo pasa en un solo update.
 *
 * Por que NO se acumula `totalRevenue` en float: sumar importes en number
 * deriva (10 x 19.99 -> 199.9). Se suma en centavos enteros y el importe se
 * deriva al leer.
 */
export async function applyOrderCreated(
  eventId: string,
  payload: OrderCreatedPayload,
): Promise<ApplyResult> {
  const parsed = parseOrderCreatedPayload(payload as unknown as Record<string, unknown>)

  if (!parsed) {
    return { applied: false, reason: 'invalid-payload' }
  }

  // Pipeline de aggregation en el update (MongoDB >= 4.2), NO el forma
  // clasica de $inc + $set.
  //
  // La forma clasica guarda la EXPRESION como si fuera un valor literal
  // (verificado: totalRevenue queda como un objeto $round anidado, no como
  // un numero). El pipeline si la evalua.
  //
  // Cada campo usa `$add: ['$campo', delta]`: dentro de una etapa $set, el
  // `$add` ya ve el valor PREVIO del documento, asi que la operacion sigue
  // siendo un incremento atomico. El `delta` se repite en el calculo del
  // importe porque `totalRevenue` tiene que reflecting el valor YA
  // incrementado: centavos_previos + delta.
  //
  // `$ifNull` es obligatorio: en un upsert los campos no existen y `$add`
  // sobre null devuelve null en vez de sumar.
  //
  // El redondeo a 2 decimales ocurre aqui, una sola vez, al escribir. Por eso
  // el read path puede devolver el importe sin hacer ninguna division.
  let result

  try {
    result = await DashboardStats.updateOne(
      {
        _id: DASHBOARD_STATS_ID,
        processedEventIds: { $ne: eventId },
      },
      [
        {
          $set: {
            totalRevenueCents: {
              $add: [{ $ifNull: ['$totalRevenueCents', 0] }, parsed.priceCents],
            },
            totalOrders: {
              $add: [{ $ifNull: ['$totalOrders', 0] }, 1],
            },
            totalRevenue: {
              $round: [
                {
                  $divide: [
                    { $add: [{ $ifNull: ['$totalRevenueCents', 0] }, parsed.priceCents] },
                    100,
                  ],
                },
                2,
              ],
            },
            processedEventIds: {
              $concatArrays: [{ $ifNull: ['$processedEventIds', []] }, [eventId]],
            },
            updatedAt: new Date(),
          },
        },
      ],
      // Mongoose rechaza un array como update salvo que se marque
      // explicitamente como updatePipeline. Sin esto tira
      // "Cannot pass an array to query updates".
      { upsert: true, updatePipeline: true },
    )
  } catch (error) {
    // E11000 sobre _id con upsert:true == el documento existe pero el
    // filtro de idempotencia no matcheo. Es el camino normal del
    // duplicado, no una falla. Verificado: el documento queda intacto.
    if (isDuplicateKeyError(error)) {
      return { applied: false, reason: 'already-processed' }
    }
    throw error
  }

  const applied = result.matchedCount > 0 || result.upsertedCount > 0

  return applied ? { applied: true } : { applied: false, reason: 'already-processed' }
}

const DUPLICATE_KEY = 11000

function isDuplicateKeyError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false

  const candidate = error as { code?: number; codeName?: string }
  return candidate.code === DUPLICATE_KEY || candidate.codeName === 'DuplicateKey'
}
