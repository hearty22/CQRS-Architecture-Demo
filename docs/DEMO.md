# Guion de demo (~4 minutos)

## 0. Preparación (antes de empezar)

```bash
docker compose down -v && docker compose up -d   # seed: 60 órdenes, $7.079,25
```

Abrí `http://localhost:5173`. Esperá el badge en verde ("en vivo").

## 1. Estado base (~30 s)

- Dos métricas: **$7.079,25** y **60**.
- El badge verde con pulso: el total llega por stream SSE, no por fetch.
- El panel **Eventos proyectados** lista las señales que ya aplicó el worker.

## 2. Consistencia eventual normal (~1 min)

1. Pestaña "Crear orden": producto `Demo en vivo`, precio `50.00` → enviar.
2. Vuelve al dashboard: total **congelado** ($7.079,25 y 60) y banner
   "1 orden guardada. El total se actualiza cuando la proyección corre."
3. 1–3 s después, solo: $7.129,25 y 61, flash azul en la fila nueva,
   señales `orders` y `stats` en el feed, y el pie con "proyectada en ~1.2 s".

## 3. El valor del outbox (~1.5 min)

1. Botón **Pausar proyección** → banner explicativo.
2. Crear otra orden (`Modo falla`, `10.00`): la app sigue respondiendo 201,
   el read model no se mueve, el feed está quieto.
3. **Reanudar proyección**: el read model se pone al día de golpe.
   "El evento no se perdió: se procesa después."

Extra con terminal a la vista:

```bash
docker compose stop postgres   # el dashboard sigue leyendo de Mongo; solo falla crear
docker compose start postgres
docker compose stop redis      # crear funciona; read model congelado
docker compose start redis     # catch-up de golpe
```

## 4. Cierre (~30 s)

```bash
docker compose stop backend    # badge a "respaldo por polling" (ámbar)
docker compose start backend   # se recupera solo
```

Tip: para mostrar el stream crudo, en otra terminal:

```bash
curl -N http://localhost:3000/api/stats/events
```
