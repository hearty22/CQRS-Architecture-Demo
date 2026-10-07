import type { ReactNode } from 'react'

/**
 * Fase 1: no hay endpoints todavia, asi que esta pantalla es un chequeo de
 * que el frontend quedo bien cableado y no inventa llamadas que van a fallar.
 * Las secciones reales aparecen cuando se sumen commands y queries.
 */
interface Service {
  name: string
  role: string
  detail: string
}

const SERVICES: Service[] = [
  {
    name: 'PostgreSQL',
    role: 'lado de escritura',
    detail: 'agregados + outbox transaccional. Fuente de verdad.',
  },
  {
    name: 'MongoDB',
    role: 'lado de lectura',
    detail: 'read models desnormalizados, alimentados por proyección.',
  },
  {
    name: 'Redis',
    role: 'event bus',
    detail: 'solo Pub/Sub. La durabilidad la aporta el outbox.',
  },
]

function Card({ children }: { children: ReactNode }) {
  return <section className="card">{children}</section>
}

export function App() {
  return (
    <main className="page">
      <header>
        <h1>CQRS API</h1>
        <p className="subtitle">
          Monolito modular · Fase 1 completa · infraestructura y estructura base
        </p>
      </header>

      <Card>
        <h2>Reparto de responsabilidades</h2>
        <ul className="services">
          {SERVICES.map((service) => (
            <li key={service.name}>
              <strong>{service.name}</strong>
              <span className="tag">{service.role}</span>
              <p>{service.detail}</p>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <h2>Proximos pasos</h2>
        <ul className="next">
          <li>CommandBus y QueryBus en <code>src/shared</code></li>
          <li>Primer comando de ejemplo y su outbox transaccional</li>
          <li>Proyeccion idempotente hacia MongoDB consumiendo Redis</li>
        </ul>
        <p className="hint">
          El proxy <code>/api</code> ya apunta a <code>backend:3000</code>; falta la
          primera ruta para comprobarlo.
        </p>
      </Card>
    </main>
  )
}
