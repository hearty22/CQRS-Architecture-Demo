# CQRS API — Monolito Modular

API en TypeScript (Node + Express) con **CQRS estricto**. PostgreSQL para
escritura, MongoDB para lectura, Redis como event bus.

## Estado

| Fase | Contenido |
|---|---|
| 1 | Infraestructura y estructura base — completa |
| 2 | Write model (`Order`) y `POST /api/orders` — completa |
| 3 | Proyección a MongoDB (`DashboardStats`) — completa |
| 4 | Read model y `GET /api/stats` — completa |
| 5 | SSE + frontend React (dashboard y alta de órdenes) — completa |

## Arquitectura

```
                  ┌──────────────────────────────┐
   HTTP ─────────▶│  src/commands   (escritura)  │──▶ PostgreSQL
                  │  src/queries    (lectura)    │──▶ MongoDB
                  │  src/worker     (relay)      │──▶ Redis Pub/Sub
                  │  src/config     (conexiones) │
                  │  src/shared     (contratos)  │
                  └──────────────────────────────┘
```

| Servicio | Rol | Regla |
|---|---|---|
| PostgreSQL 18 | Lado de escritura | Fuente de verdad. Agregados + outbox. |
| MongoDB 8.3 | Lado de lectura | Read models. Nunca fuente de verdad. |
| Redis 8 | Event bus | **Solo Pub/Sub.** Sin caché, sin colas, sin locks. |

## Por qué existe el outbox

Redis Pub/Sub es *fire-and-forget*: si el worker o los suscriptores están
caídos, los eventos se pierden en silencio y los read models de MongoDB
divergen del write model de Postgres.

`prisma/schema.prisma` define la tabla `outbox`. El command handler escribe
el agregado **y** la fila del evento en la misma transacción; el evento se
publica a Redis **solo después** del commit. Eso da semántica
*at-least-once*, y por eso las proyecciones deben ser idempotentes
(upsert por `eventId`).

## API

`POST /api/orders`

```bash
curl -X POST http://localhost:3000/api/orders \
  -H 'content-type: application/json' \
  -d '{"productName":"Teclado mecanico","price":19.99}'
```

```json
{
  "data": {
    "id": "45e8cd27-510a-49b4-9bab-4dc3e50c8bbf",
    "productName": "Teclado mecanico",
    "price": "19.99",
    "createdAt": "2026-10-07T02:32:04.118Z"
  }
}
```

`price` vuelve como string a propósito: es un `Decimal` de Prisma y
mandarlo como `number` por JSON reintroduce el error de punto flotante en
el cliente. Quien necesite número lo convierte explícitamente.

Eventos publicados en el canal `orders_events` (vía el relay del outbox,
~1s después del 201):

```json
{
  "eventId": "47785c93-8375-47b1-89b7-574cf079b7a9",
  "channel": "orders_events",
  "aggregateType": "Order",
  "aggregateId": "78c5a4b4-8e17-4baa-a543-0f5342164568",
  "eventType": "ORDER_CREATED",
  "occurredAt": "2026-10-07T02:33:35.097Z",
  "payload": {
    "type": "ORDER_CREATED",
    "orderId": "78c5a4b4-8e17-4baa-a543-0f5342164568",
    "productName": "AuricularesANC",
    "price": 349.9,
    "occurredAt": "2026-10-07T02:33:35.096Z"
  }
}
```

### Códigos de respuesta

| Código | Cuándo |
|---|---|
| 201 | Orden creada y evento en el outbox |
| 400 `VALIDATION_ERROR` | Body inválido, con detalle por campo en `details` |
| 400 `INVALID_JSON` | Body que ni siquiera es JSON |
| 404 `NOT_FOUND` | Ruta inexistente |
| 500 `INTERNAL_ERROR` | Fallo nuestro; nunca expone el mensaje interno |

#`GET /api/stats`

```bash
curl http://localhost:3000/api/stats
# {"data":{"totalRevenue":3732.85,"totalOrders":23,"updatedAt":"2026-10-07T03:03:06.285Z"}}
```

`GET /api/dashboard/stats` responde **301** hacia `/api/stats` (ruta de la
fase 3, conservada para no romper consumidores).

Devuelve `404 NO_STATS` en vez de un total en cero cuando todavía no se
procesó ningún `ORDER_CREATED`: "no hay datos" y "la facturación es cero" son
cosas distintas, y confundirlas muestra 0 $ en un dashboard.

Es consistencia **eventual**: el total refleja lo que el worker ya proyectó,
no necesariamente el último `POST`.

### El read path es O(1) y no calcula nada

Un `findById` sobre el índice `_id_`: sin agregaciones, sin sort, sin filtros
por rango. Nada que pueda degradar con el volumen.

Y el handler **no hace aritmética**: `totalRevenue` viene precalculado en el
documento. El único round-trip es a MongoDB — ni PostgreSQL ni Redis. Las
tres reglas son verificables y hay tests que fallan si se rompen:

| Regla | Test |
|---|---|
| El command side no conoce MongoDB | `el command side no depende de MongoDB` |
| El query side no toca Postgres ni Redis | `el query side no toca Postgres ni Redis` |
| El read path no opera sobre los datos | `el read path no hace aritmetica sobre los datos` |

### Datos de prueba

```bash
docker compose up -d      # ya siembra solo: 20 órdenes y $2.359,75
```

`docker compose up -d` levanta un servicio `init` one-shot que aplica
migraciones, siembra y termina; el backend espera a que termine con
`service_completed_successfully`. El orden queda garantizado: **migrar →
sembrar → levantar la API**. Con un flag condicional en el CMD del backend, un
arranque mal sincronizado sembraría contra un schema viejo y fallaría sin decir
por qué.

```bash
SEED_ON_START=false docker compose up -d   # arrancar sin datos
SEED_ORDERS=100 docker compose up -d       # otra cantidad
docker compose run --rm backend pnpm seed -- 50 --reset   # forzar de cero
docker compose run --rm backend pnpm db:reset -- 20       # limpiar y re-sembrar
```

**El seed es idempotente por decisión, no por escritura.** Consulta si ya hay
órdenes y no hace nada si las hay. Hace falta porque `init` corre en *cada* `up`:
sin ese corte, el segundo arranque duplicaría las 20 órdenes y el read model
mostraría el doble. La escritura no se hizo idempotente a propósito: preguntar
"¿ya hay datos?" es una consulta barata y explícita, mientras que hacer el
insert idempotente escondería la decisión dentro de la operación.

El seed usa **`handleCreateOrder`**, el mismo handler que el endpoint HTTP, y
no un `insert` directo. Es lo que lo hace útil: si insertara con SQL crudo
llenaría `orders` pero no `outbox`, y el dashboard quedaría en cero mientras la
tabla muestra 20 órdenes — el bug de inconsistencia que el outbox existe para
evitar, reintroducido a propósito.

Los precios por defecto están elegidos para **exponer la deriva de float**
(1.15, 1234.56, 0.07, 0.01). Con un catálogo de precios "redondos" el total
saldría bien por casualidad y el acumulador en centavos no probaría nada:

```
20 órdenes →  2359.75        (exacto, en centavos)
             2359.7499999999995  (si se acumulara en float)
```

### Cómo se actualiza el dashboard

`GET /api/stats/events` es un stream **Server-Sent Events**. La proyección
notifica cuando cambia el read model y el cliente revalida contra
`GET /api/stats`.

**El stream no lleva el importe, solo la señal.** El total que emitió una
proyección puede quedar obsoleto si otra orden entra un milisegundo después, así
que mandarlo por el stream congelaría un valor viejo en pantalla. El payload es
`{ revision, updatedAt, reason }` y el cliente siempre revalida.

**La señal sale de la proyección, no del POST.** El `201` llega antes de que el
evento exista en Redis; notificar desde el handler haría que el dashboard se
refrescara y mostrara el total viejo.

**El polling de respaldo corre siempre** (5s), no solo cuando el stream cae: si
el SSE se corta y no hay respaldo, el dashboard queda congelado sin explicación.
Cada 30s hay además una revalidación aunque el stream esté sano, porque una
señal perdida en la red no se puede detectar del lado del cliente.

```bash
cd frontend && pnpm test:sse   # verificación del stream contra el backend real
```

Criterios de aceptación de la UI para probar a mano: ver `docs/criterios-ui.md`.

### Comandos

```bash
docker compose up -d          # todo
docker compose logs -f backend
docker compose down           # parar (conserva datos)
docker compose down -v        # parar y borrar datos
```

- Frontend: http://localhost:5173
- Backend: http://localhost:3000
- PostgreSQL: `localhost:5433`, MongoDB: `localhost:27018`, Redis: `localhost:6380`

Los puertos de datos están desfasados porque 5432/27017/6379 ya estaban
ocupados en esta máquina. Se ajustan en `.env` vía `*_PUBLISHED_PORT`.

### Fuera de Docker

```bash
cd backend && pnpm install && pnpm dev
cd frontend && pnpm install && pnpm dev
```

`backend/.env` solo lo necesita el Prisma CLI fuera de Docker; en runtime
`src/config/env.ts` deriva las URLs desde `POSTGRES_*`, `MONGO_*` y
`REDIS_*`.

## Estructura

```
backend/src/
├── app.ts          fábrica de Express (sin listen, testeable)
├── index.ts        bootstrap, readiness y cierre en dos fases
├── seed/           seed.ts (datos de prueba) y reset.ts (limpiar + re-sembrar)
├── commands/       ← ESCRITURA. Nunca importa MongoDB (verificado por test)
│   ├── index.ts    monta los módulos de comando bajo /api
│   └── orders/
│       ├── create-order.command.ts   contrato + validación zod
│       ├── create-order.handler.ts   $transaction: orders + outbox
│       ├── orders.routes.ts          POST /
│       └── index.ts
├── queries/        ← LECTURA. Solo MongoDB, sin aritmética (verificado por test)
│   ├── index.ts              monta /api/stats, /api/stats/events y el 301 viejo
│   ├── stats.routes.ts       GET /api/stats
│   ├── stats-events.routes.ts    GET /api/stats/events  (SSE)
│   ├── stats.notifier.ts     emitter local: "el read model cambió"
│   ├── stats.read-model.ts   findById → copia de campos, sin cálculo
│   ├── dashboard-stats.model.ts   read model: _id fijo 'global'
│   └── orders/dashboard-stats.routes.ts   301 → /api/stats
├── worker/
│   ├── index.ts              ciclo de vida; suscribe ANTES de publicar
│   ├── outbox-relay.ts       relay Postgres → Redis
│   ├── orders-events.subscriber.ts  consume orders_events + notifica SSE
│   └── order-stats.projection.ts    update pipeline idempotente
├── config/         env (zod), postgres, mongodb, redis
└── shared/         logger, errores HTTP, canales, contratos

backend/tests/
├── architecture.test.ts      las reglas de aislamiento, ejecutables
├── channel-parsing.test.ts    parseo de envelopes y centavos
├── channels.test.ts          contrato de nombres de canal
├── create-order.command.test.ts
├── stats.read-model.test.ts  contrato del read model
├── stats-events.test.ts      payload SSE y formato del frame
├── seed.test.ts              aritmética del seed
└── http.test.ts              capa HTTP sin base

frontend/src/
├── api/
│   ├── contract.ts   tipos + parseo + validación (funciones puras, testeables)
│   └── client.ts     fetch contra /api (rutas relativas: sin CORS)
├── hooks/useStats.ts EventSource + polling de respaldo
└── components/       Dashboard, CreateOrderForm, StreamBadge

frontend/tests/
├── contract.test.ts  27 tests del contrato (sin navegador)
└── sse-live.ts       verificación del stream contra el backend real
```

## El puente: por qué `$inc` solo no alcanza

El bus es *at-least-once*. El relay republica si la confirmación falla, y Redis
Pub/Sub no garantiza nada. Con un `$inc` a secas, un reintento infla el total:

```
orden creada → relay publica → worker suma → worker se cae → relay reintenta
→ suma OTRA VEZ → totalRevenue inflado
```

Un `$inc` es atómico pero **no idempotente**. La solución es que el filtro del
update incluya la deduplicación:

```js
updateOne(
  { _id: 'global', processedEventIds: { $ne: eventId } },
  { $inc: { totalRevenueCents, totalOrders: 1 }, $push: { processedEventIds: eventId } },
  { upsert: true },
)
```

Una sola operación atómica: si el evento ya se aplicó, el filtro no matchea y
MongoDB no toca nada.

**Por qué no un ledger en otra colección:** insert + `$inc` serían dos
operaciones, y MongoDB **standalone no soporta transacciones multi-documento**
(lo verifiqué: `NoReplicationEnabled`). Quedaría una ventana donde el evento
queda marcado como visto pero nunca suma. Con esta forma no hay ventana.

**El detalle de E11000:** cuando el filtro no matchea pero el documento ya
existe, `upsert: true` intenta insertar y falla con duplicate key en vez de
reportar "no matche nada". Por eso el `E11000` se interpreta como
"ya procesado" y no como error — sin eso, cada reintento generaba un ERROR en
los logs aunque el total estuviera bien.

### `totalRevenue` se precalcula al escribir, no al leer

Para que el read path devuelva el importe sin hacer `totalRevenueCents / 100`,
el importe en reales **se persiste**. El worker lo recalcula dentro de la
misma operación atómica que incrementa los centavos, con un **update pipeline**
de agregación:

```js
[{ $set: {
  totalRevenueCents: { $add: [{ $ifNull: ['$totalRevenueCents', 0] }, 1999] },
  totalOrders:       { $add: [{ $ifNull: ['$totalOrders', 0] }, 1] },
  totalRevenue:      { $round: [{ $divide: [{ $add: [..., 1999] }, 100] }, 2] },
}}]
```

Tres cosas que-costó-atajos:

1. **La forma clásica de `$set` no sirve.** Escribir `$set: { totalRevenue: { $divide: [...] } }` guarda la **expresión como objeto literal**: el campo queda como `{"$round":[{"$divide":[...]}]}` en el documento. Solo el pipeline la evalúa. Lo verifiqué contra MongoDB 8.3 antes de escribir código.
2. **Mongoose exige `{ updatePipeline: true }`** al pasar un array como update. Sin eso: `Cannot pass an array to query updates`. Este error apareció en runtime, después de que el typecheck pasara.
3. **`$ifNull` es obligatorio.** En un upsert los campos no existen, y `$add` sobre `null` devuelve `null` en vez de sumar (verificado: `{"n": null}`).

Efecto medido: 10 × 1.15 acumular en float da `3731.7000000000007`; con el
pre-cálculo y `$round`, `3731.7` exacto.

### Las reglas de aislamiento son ejecutables

`tests/architecture.test.ts` falla si un módulo se importa donde no debe:

| Regla | Test |
|---|---|
| El command side no conoce MongoDB | `el command side no depende de MongoDB` |
| El command side no monta endpoints de lectura | `el command side no monta endpoints de lectura` |
| El query side no toca Postgres ni Redis | `el query side no toca Postgres ni Redis` |
| El read path no opera sobre los datos | `el read path no hace aritmetica sobre los datos` |

Leer la tabla de escritura desde un endpoint de lectura es el anti-patrón de
CQRS, y consultarla desde el write side es lo mismo al revés.

Los patrones buscan sobre **código**, no sobre texto: los comentarios se borran
antes de verificar, para que el docstring que explica la regla no la haga fallar.
Hay además un test "meta" que confirma que el detector detecta código prohibido
y no marca prosa — sin él, la regla podría no estar probando nada.

Verificado que fallan: inyectando `totalRevenueCents / 100` en el read-model y
`redisPublisher.publish` en el router, ambos tests los detectaron y nombraron el
archivo y la razón.

## Decisiones que conviene conocer antes de tocar el código

- **Prisma pineado en `7.10.0`.** El tag `latest` del CLI es `8.0.0-rc.20`,
  una release candidate. Además Prisma 7 movió la `url` del datasource a
  `prisma7.config.ts` y usa *driver adapters* (`@prisma/adapter-pg`) en
  lugar de `datasourceUrl`.
- **`mongo:8.3`, no `mongo:9`.** La tabla oficial de Mongoose 9 cubre el
  server 8.x/7.x/6.x y todavía no lista 9.x.
- **Node 24 en los Dockerfile.** Prisma 7.10 declara soporte hasta 24.0+.
- **pnpm se instala con `npm i -g`.** Node 24+ ya no trae corepack.
- **`allowBuilds` en `pnpm-workspace.yaml`.** pnpm 11 eliminó
  `onlyBuiltDependencies` y bloquea los postinstall de Prisma/esbuild.
- **Volumen nombrado en `/app/node_modules`.** Sin él, el bind mount del
  host rompe los symlinks de pnpm.
- **Vite escucha en `0.0.0.0`** y proxea `/api` al backend, lo que evita
  CORS en dev y replica el nginx de producción.

## El worker vive dentro del backend

Decisión conscious para esta fase: un proceso, un Dockerfile. Como el
worker también atenderá consultas HTTP, se lo protege con seis guardarraíles
(documentados en el código):

1. `pg_try_advisory_lock` sobre un `pg.Client` **dedicado** — una sola
   réplica relays. Va en un cliente propio y no en el pool de Prisma porque
   el lock es de *sesión*: atado a una conexión física, y el pool puede
   atender cada query en una distinta, dejando el lock huérfano.
2. Flag `RUN_WORKER` para apagarlo sin tocar código.
3. `FOR UPDATE SKIP LOCKED` al reclamar filas.
4. `try/catch` por mensaje: un evento envenenado no corta el lote ni tumba
   la API.
5. Arranca **después** de que el server escucha; nunca en el path de un
   request.
6. Cierre en dos fases: primero el worker, después HTTP, después conexiones.

## Límites conocidos

**`processedEventIds` crece sin límite.** MongoDB topdocuments en 16 MB; a ~40
bytes por UUID son **~400k eventos** antes de romper. Cuando se alcance, la
rotación tiene que ser por **ventana temporal** (los ids más viejos por
`occurredAt`): un corte arbitrario permitiría reprocesar un evento ya
evictado y lo volvería a contar.

**Si MongoDB está caído, los eventos en vuelo se pierden.** Pub/Sub no tiene
reintento ni cola: el mensaje ya no está y el `outbox` es lo único que
permite reprocesar. El worker loguea el error y sigue, sin tumbar la API.

**Un corte de la suscripción pierde lo que ocurra en el medio.** Si el worker
se desconecta un segundo, los eventos de ese segundo no llegan a nadie. Es
inherente a Redis Pub/Sub; la alternativa sería un stream con consumer groups
(`XREADGROUP`), que no estaba en el alcance pedido.

**La proyección depende del relay.** Ambos viven en el mismo proceso. Con
`RUN_WORKER=false` no hay quien publique ni quien consuma.

## Estado verificado

- `docker compose up` levanta los 5 servicios; las tres conexiones abren y
  `migrate deploy` aplica las 2 migraciones.
- `POST /api/orders` devuelve 201 y escribe `orders` + `outbox` en la misma
  transacción. Confirmado en SQL que cada orden tiene su evento, en el canal
  correcto y con `orderId` coincidente.
- El relay publica ~1s después: capturado con un `redis-cli subscribe
  orders_events` en vivo.
- **Idempotencia probada de verdad**: republicar un `eventId` ya aplicado
  deja el total intacto. Y al hacer `UPDATE outbox SET published_at = NULL`
  (el relay republica todo), 23 eventos se reprocesaron: 22 ignorados como
  duplicados y 1 nuevo aplicado.
- **11 mensajes hostiles** (JSON roto, sin envelope, `price: "abc"`, `1e300`,
  negativos, canal ajeno): el proceso sigue vivo, 0 errores, y solo se aplicó
  el que era un payload válido.
- `GET /api/stats` devuelve el importe **precalculado**: 10 × 1.15 dan
  `3731.7` exacto, donde acumular en float daría `3731.7000000000007`.
- La ruta vieja responde 301 y seguir el redirect da 200 en `/api/stats`.
- El cierre por `SIGTERM` corre en orden: relay → desuscripción → conexiones.
- 52 tests en verde, `typecheck` limpio en src y tests.
- **Seed de 20 órdenes**: `2359.75` exacto vía endpoint y vía MongoDB
  (20 órdenes, 20 ids de idempotencia). Reprocesar el outbox entero deja el
  total intacto: 21 duplicados ignorados, 0 aplicados.

## Lo que aprendí de los detalles

- **`payload.type` se cruza contra `eventType`.** El dispatcher ya filtra por
  `eventType`, pero un productor con el schema desfasado puede mandar
  `type: 'OTRO'` dentro de un envelope `ORDER_CREATED`. Lo encontré con un
  fuzz de 11 mensajes: ese payload se contaba igual e inflaba el total en
  10.00. Ahora `parseOrderCreatedPayload` rechaza cualquier `type` que no sea
  `ORDER_CREATED`.
- **`totalRevenue` es un campo persistido**, recalculado por el worker en la
  misma operación que los centavos. Ya no es un virtual de Mongoose: tener las
  dos fuentes de verdad para el mismo número era peor que duplicar la ruta.
- **El read path tiene un guard de tipo.** Si el documento viniera con un
  `totalRevenue` no numérico (por ejemplo la expresión sin evaluar de un
  `$set` mal escrito), el handler lanza en vez de devolver `null` al cliente.
- **El worker se suscribe ANTES de que arranque el relay.** Al revés, los
  eventos publicados en esa ventana se perderían sin destinatario y Pub/Sub
  no los reenvía. En el cierre es simétrico: relay primero, desuscripción
  después.

## Detalles que no son obvios

- **`price` es `Decimal` → `numeric(12,2)`, y el body se valida con epsilon.**
  `19.99 * 100 === 1998.9999999999998` en IEEE-754, así que un
  `Number.isInteger(value * 100)` rechazaría precios legítimos. Y un
  `multipleOf(0.01)` sin tolerancia deja pasar `10.999`. La validación usa
  `Math.abs(value * 100 - Math.round(value * 100)) < 1e-9`: rechaza el tercer
  decimal en vez de redondear en silencio, que perdería plata.
- **`OrderCreatedPayload` es `type`, no `interface`.** Prisma exige
  `InputJsonObject` y solo los type alias de objeto literales reciben la firma
  de índice implícita que lo hace asignable.
- **`jsonSyntaxErrorHandler` va después de `express.json()`.** El `SyntaxError`
  lo produce el parser, así que el middleware tiene que estar montado abajo; si
  se registra antes, nunca lo ve y un body roto devuelve 500 en vez de 400.
- **Los tests setean el env antes de importar la app.** `config/env.ts` valida
  con zod en el momento del import y throwea; en ESM los imports se evalúan
  antes que el cuerpo del módulo, por eso es un `await import()` dinámico.
- **El server de los tests HTTP se levanta en `before`.** `listen()` dentro del
  `describe` no funciona porque las pruebas corren concurrentemente.

## Pendiente para fases siguientes

- Rotación de `processedEventIds` por ventana temporal
- Read model de `orders` en MongoDB y `GET /api/orders` desde el read side
- Comando de rebuild que trunque MongoDB y reprocese el outbox
- Endpoint `/health`
- Tests de componentes (requiere testing-library)
- Imagen de producción (multi-stage + nginx)

## Límites que conviene conocer

**El emitter de SSE es local al proceso.** Funciona porque el worker vive dentro
del backend. Si se separa a otro contenedor, el `EventEmitter` no cruza
containers y hay que reemplazarlo por el bus de Redis.

**Una pestaña con el stream cortado se re-resuscita sola, pero con polling.**
Si el SSE muere, `EventSource` reconecta por su cuenta y el badge pasa a
"respaldo por polling" para que se note.
