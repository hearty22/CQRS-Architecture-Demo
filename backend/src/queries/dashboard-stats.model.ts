import mongoose, { Schema } from 'mongoose'

/**
 * Read model:estadisticas agregadas del negocio.
 *
 * Vive en MongoDB y NO es fuente de verdad. Se deriva de los eventos del
 * canal `orders_events` y se puede reconstruir reprocesando el outbox.
 *
 * Singleton por constraint, no por convencion: el _id esta fijado al
 * literal 'global', asi que el segundo insert choca con clave duplicada y
 * no puede haber dos documentos.
 */
export const DASHBOARD_STATS_ID = 'global'

const dashboardStatsSchema = new Schema(
  {
    _id: { type: String, default: DASHBOARD_STATS_ID },

    /**
     * Fuente de verdad del importe. Entero, nunca float.
     *
     * Sumar importes en `number` deriva: 1.15 x 10 acumulado da
     * 11.500000000000002, y 1234.56 x 10 da 12345.599999999997.
     */
    totalRevenueCents: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },

    /**
     * Importe en reales, PRE-CALCULADO por la proyeccion.
     *
     * Se persiste para que el endpoint de lectura no tenga que hacer
     * `totalRevenueCents / 100` en cada request: el read path tiene que
     * devolver el valor ya calculado, sin aritmetica en tiempo real.
     *
     * El worker lo recalcula dentro de la MISMA operacion atomica que
     * incrementa los centavos, a partir del valor ya incrementado. Por eso
     * nunca queda desfasado respecto de totalRevenueCents.
     *
     * `$round` a 2 decimales: el redondeo ocurre una sola vez, al escribir.
     */
    totalRevenue: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },

    totalOrders: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },

    /**
     * Ids de eventos ya aplicados. Es lo que hace idempotente el `$inc`.
     *
     * LÍMITE CONOCIDO: este array crece sin limite y MongoDB topdocuments
     * en 16 MB. A ~40 bytes por UUID son ~400k eventos antes de romper.
     * Cuando se alcance, hay que rotarlo por VENTANA TEMPORAL (los ids mas
     * viejos por occurredAt): un corte arbitrario permitiria reprocesar un
     * evento ya evictionado y volveria a contarlo.
     */
    processedEventIds: {
      type: [String],
      default: [],
      select: false,
    },

    updatedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
  },
  {
    collection: 'dashboard_stats',
    versionKey: false,
    toJSON: { virtuals: false },
    toObject: { virtuals: false },
  },
)

export type DashboardStatsDocument = mongoose.Document & {
  _id: string
  totalRevenueCents: number
  totalRevenue: number
  totalOrders: number
  updatedAt: Date
}

export const DashboardStats = mongoose.model('DashboardStats', dashboardStatsSchema)
