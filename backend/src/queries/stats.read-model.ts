import { DASHBOARD_STATS_ID, DashboardStats } from './dashboard-stats.model.js'

/** Lo que devuelve el endpoint. Tal cual esta persistido, sin calculos. */
export interface DashboardStatsView {
  totalRevenue: number
  totalOrders: number
  updatedAt: string
}

/**
 * Lectura del read model.
 *
 * O(1) por construccion: un findById sobre el indice `_id_`, que es el
 * unico que se consulta. No hay agregaciones, no hay sort, no hay filter
 * por rango: nada que pueda degradar con el volumen de datos.
 *
 * CERO ARITMETICA. Los campos se devuelven tal cual los escribio la
 * proyeccion. En particular NO se divide `totalRevenueCents / 100` aca:
 * ese redondeo ocurre una sola vez, al escribir, y por eso el importe en
 * reales puede vivir ya persistido en el documento.
 *
 * NO toca PostgreSQL ni Redis. Este es el unico punto de contacto con el
 * sistema: un unico round-trip a MongoDB.
 */
export async function readDashboardStats(): Promise<DashboardStatsView | null> {
  const doc = await DashboardStats.findById(DASHBOARD_STATS_ID)
    // .lean() devuelve el objeto plano: sin crear documentos de Mongoose,
    // sin hydrated getters, sin casts. Es lo mas barato que se puede leer.
    .select('totalRevenue totalOrders updatedAt')
    .lean<{
      totalRevenue: number
      totalOrders: number
      updatedAt: Date
    } | null>()
    .exec()

  if (!doc) return null

  // Guarda contra un documento corrupto o escrito por una version anterior
  // del modelo. Sin esto, un totalRevenue no numerico llegaria al cliente
  // como null o como un objeto, que es peor que un 500.
  if (typeof doc.totalRevenue !== 'number' || !Number.isFinite(doc.totalRevenue)) {
    throw new Error('el read model dashboard_stats tiene totalRevenue invalido')
  }

  // Copia de campos, no aritmetica. La unica transformacion es el Date a
  // ISO, que es formato de transporte y no un calculo sobre el dato.
  return {
    totalRevenue: doc.totalRevenue,
    totalOrders: doc.totalOrders,
    updatedAt: doc.updatedAt.toISOString(),
  }
}
