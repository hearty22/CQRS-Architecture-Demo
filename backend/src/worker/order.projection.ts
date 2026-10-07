/**
 * Proyección de ORDER_CREATED al read model de órdenes.
 *
 * IDEMPOTENCIA POR CLAVE PRIMARIA: `_id = orderId`. Un `updateOne` con
 * `upsert` inserta la primera vez y actualiza después; nunca duplica.
 *
 * No hay array de `processedEventIds` como en el modelo de estadísticas. Ese
 * array existe porque el read model es UN documento compartido por todos los
 * eventos; acá hay un documento por evento, así que la clave primaria ya
 * cumple esa función.
 */

import { Order } from '../queries/orders/order.model.js'
import { parseOrderCreatedPayload } from '../shared/channels.js'
import type { OrderCreatedPayload } from '../shared/channels.js'

export interface ProjectOrderResult {
  applied: boolean
  created: boolean
}

/**
 * Aplica una orden al read model.
 *
 * El `$set` con `$round` mantiene el invariante: `price` se pre-calcula en
 * la escritura, para que el read path no tenga que dividir. Es el mismo
 * patrón que `DashboardStats.totalRevenue`, y por el mismo motivo.
 */
export async function projectOrder(
  orderId: string,
  payload: OrderCreatedPayload,
  occurredAt: Date = new Date(),
): Promise<ProjectOrderResult> {
  const parsed = parseOrderCreatedPayload(payload as unknown as Record<string, unknown>)

  if (!parsed) {
    return { applied: false, created: false }
  }

  const result = await Order.updateOne(
    { _id: orderId },
    {
      $set: {
        productName: payload.productName,
        priceCents: parsed.priceCents,
        createdAt: occurredAt,
        projectedAt: new Date(),
      },
      $setOnInsert: { _id: orderId },
    },
    { upsert: true },
  )

  // upsertedCount > 0 significa que el documento no existía: se creó.
  // matchedCount > 0 con upsertedCount 0 significa que se actualizó.
  const created = result.upsertedCount > 0

  return { applied: true, created }
}