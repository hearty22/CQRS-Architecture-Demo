/**
 * Read model de órdenes.
 *
 * Un documento POR orden, con `_id = orderId`. Eso hace que la proyección sea
 * idempotente de forma natural: un `upsert` sobre `_id` inserta una vez o
 * actualiza, nunca duplica.
 *
 * Es la diferencia con el modelo de estadísticas, que es un singleton y
 * necesita el array `processedEventIds` para no contar dos veces. Con una
 * collection por documento, la deduplicación la da la clave primaria.
 *
 * El shape tiene forma de CONSULTA: se guardan solo los campos que la lista
 * muestra. No se arrastra nada de bookkeeping del write model.
 */

import mongoose, { Schema } from 'mongoose'

const orderSchema = new Schema(
  {
    // _id ES el orderId del write model. Esa es la clave de idempotencia:
    // un upsert sobre _id inserta una vez o actualiza, nunca duplica.
    _id: { type: String, required: true },

    productName: { type: String, required: true },

    /**
     * Importe en centavos enteros, igual que en el modelo de estadísticas.
     * El read path lo devuelve tal cual; la conversión a decimal ocurre en
     * la capa HTTP, una sola vez.
     */
    priceCents: { type: Number, required: true, min: 0 },

    createdAt: { type: Date, required: true },
    projectedAt: { type: Date, required: true, default: Date.now },
  },
  {
    collection: 'orders',
    versionKey: false,
  },
)

/**
 * Índice de la consulta de listado.
 *
 * La paginación por cursor ordena por `createdAt DESC` y desempata con `_id`.
 * Sin este índice, cada página es un scan completo de la collection.
 */
orderSchema.index({ createdAt: -1, _id: -1 })

export const Order = mongoose.model('Order', orderSchema)