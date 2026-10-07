import { z } from 'zod'

/**
 * Command: intencion de escritura.
 *
 * Un command es una Peticion: describe QUE se quiere hacer, nunca lo
 * hace. Por eso se valida aca y no en el handler.
 */
export interface CreateOrderCommand {
  productName: string
  price: number
}

/**
 * Validacion del body.
 *
 * Dos detalles no obvios:
 *
 * - `z.coerce.number()` acepta 'NaN' e infinitos, asi que el refine
 *   con isFinite es necesario, no decorativo.
 * - `multipleOf(0.01)` rechaza mas de 2 decimales, que la columna
 *   numeric(12,2) truncaría en silencio.
 */
export const createOrderSchema = z.object({
  productName: z
    .string()
    .trim()
    .min(1, 'productName no puede estar vacio')
    .max(255, 'productName no puede superar 255 caracteres'),
  price: z.coerce
    .number({ error: 'price debe ser un numero' })
    .refine((value) => Number.isFinite(value), 'price debe ser un numero finito')
    .refine((value) => value > 0, 'price debe ser mayor que 0')
    // Se RECHAZA el tercer decimal en vez de redondear: aceptarlo en
    // silencio perderia plata sin que el cliente se entere.
    //
    // El epsilon de 1e-9 es necesario porque 19.99 * 100 da
    // 1998.9999999999998 en IEEE-754, y sin tolerancia un precio valido
    // seria rechazado.
    .refine(
      (value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-9,
      'price admite maximo 2 decimales',
    ),
})

export type CreateOrderInput = z.infer<typeof createOrderSchema>
