import { CHANNELS } from '../../shared/channels.js'
import type { CreateOrderCommand } from './create-order.command.js'
import type { OrderCreatedPayload } from '../../shared/channels.js'
import { prisma } from '../../config/postgres.js'

export interface CreateOrderResult {
  id: string
  productName: string
  /** String plano: Decimal de Prisma no es JSON-serializable a numero. */
  price: string
  createdAt: string
}

/**
 * Escribe la orden Y su evento en la MISMA transaccion.
 *
 * Regla dura del command side: este modulo no importa, conecta ni
 * menciona MongoDB. Solo PostgreSQL (write model + outbox) y Redis
 * (event bus). Hay un test que falla si aparece un import de mongodb.
 *
 * No se publica a Redis aca: el evento sale por el relay del outbox
 * (~1s despues). Publicar directo abriria una ventana entre el commit
 * y el publish donde un crash pierde el evento para siempre, sin forma
 * de detectarlo.
 */
export async function handleCreateOrder(command: CreateOrderCommand): Promise<CreateOrderResult> {
  const order = await prisma.$transaction(async (tx) => {
    const created = await tx.order.create({
      data: {
        productName: command.productName,
        price: command.price,
      },
    })

    const payload: OrderCreatedPayload = {
      type: 'ORDER_CREATED',
      orderId: created.id,
      productName: created.productName,
      // Decimal.toString() -> '19.99' exacto, sin pasar por float.
      price: Number(created.price.toString()),
      occurredAt: created.createdAt.toISOString(),
    }

    await tx.outbox.create({
      data: {
        aggregateType: 'Order',
        aggregateId: created.id,
        eventType: 'ORDER_CREATED',
        channel: CHANNELS.ordersEvents,
        payload,
      },
    })

    return created
  })

  return {
    id: order.id,
    productName: order.productName,
    price: order.price.toString(),
    createdAt: order.createdAt.toISOString(),
  }
}
