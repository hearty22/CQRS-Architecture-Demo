import { useState } from 'react'

import type { CreatedOrder, OrderDraft } from '../api/contract'
import { ApiError, createOrder } from '../api/client'
import { buildOrderBody, validateOrderDraft } from '../api/contract'

export interface CreateOrderFormProps {
  /** Se llama cuando el POST devuelve 201. */
  onCreated: (order: CreatedOrder) => void
}

const EMPTY: OrderDraft = { productName: '', price: '' }

export function CreateOrderForm({ onCreated }: CreateOrderFormProps) {
  const [draft, setDraft] = useState<OrderDraft>(EMPTY)
  const [errors, setErrors] = useState<ReturnType<typeof validateOrderDraft>>([])
  const [serverError, setServerError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const errorFor = (field: 'productName' | 'price') =>
    errors.find((error) => error.field === field)?.message

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setServerError(null)

    const validation = validateOrderDraft(draft)
    setErrors(validation)

    if (validation.length > 0) return

    const body = buildOrderBody(draft)
    if (body === null) return

    setSubmitting(true)

    try {
      const order = await createOrder(body)
      onCreated(order)
      setDraft(EMPTY)
    } catch (caught) {
      // Un 400 trae el detalle por campo del backend; se muestra tal cual
      // en vez de un "algo salió mal" que no ayuda a corregir nada.
      setServerError(
        caught instanceof ApiError ? caught.message : 'no se pudo conectar con la API',
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form className="stack" onSubmit={handleSubmit} noValidate>
      <div className="field">
        <label htmlFor="productName">Producto</label>
        <input
          id="productName"
          name="productName"
          type="text"
          autoComplete="off"
          value={draft.productName}
          onChange={(event) => setDraft({ ...draft, productName: event.target.value })}
          aria-invalid={errorFor('productName') !== undefined}
          placeholder="Teclado mecánico"
        />
        {errorFor('productName') !== undefined && (
          <p className="field__error">{errorFor('productName')}</p>
        )}
      </div>

      <div className="field">
        <label htmlFor="price">Precio</label>
        <input
          id="price"
          name="price"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={draft.price}
          onChange={(event) => setDraft({ ...draft, price: event.target.value })}
          aria-invalid={errorFor('price') !== undefined}
          placeholder="19.99"
        />
        {errorFor('price') !== undefined ? (
          <p className="field__error">{errorFor('price')}</p>
        ) : (
          <p className="field__hint">Máximo 2 decimales. Se guarda como Decimal, no float.</p>
        )}
      </div>

      {serverError !== null && <p className="alert alert--error">{serverError}</p>}

      <button type="submit" className="button" disabled={submitting}>
        {submitting ? 'Guardando…' : 'Crear orden'}
      </button>

      <p className="muted small">
        El <code>201</code> llega antes de que el total se actualice: el evento sale por el
        outbox y la proyección corre ~1 s después.
      </p>
    </form>
  )
}