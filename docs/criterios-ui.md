# Criterios de aceptación de la UI

Abrí **http://localhost:5173**. Con `docker compose up -d` el estado inicial
esperado es **20 órdenes** y **$2.359,75** (el seed corre solo).

Cada criterio va como **pasa / falla**. Si falla, anotá qué esperabas, qué viste
y la línea de consola.

## A. Carga inicial — bloqueante

| # | Acción | Esperado |
|---|---|---|
| A1 | Abrir la app | 2 métricas: **$2.359,75** y **20** |
| A2 | Ver el badge | "en vivo", punto verde, en ~1s |
| A3 | Debajo de las métricas | "Proyectado hace X · `GET /api/stats`" |
| A4 | Consola del browser | **Cero errores** |
| A5 | Recargar | Los valores persisten (vienen de MongoDB, no del estado local) |

## B. Alta de órdenes — bloqueante

| # | Acción | Esperado |
|---|---|---|
| B1 | Pestaña "Crear orden" → nombre `Test UI`, precio `10.50` | Formulario vacío |
| B2 | Enviar | Vuelve al Dashboard **sin refresh manual** |
| B3 | **Inmediatamente** | Total **igual**: $2.359,75 y 20 |
| B4 | Banner | "1 orden guardada. El total se actualiza cuando la proyección corre." |
| B5 | **1–3 s después** | $2.370,25 y 21, **solo** |
| B6 | Banner | **Desaparece solo** |
| B7 | Pie de página | "Última orden: **Test UI** · $10.50 · `a1b2c3d4`" |

> **B3 es el criterio clave.** Si el total ya aparece cambiado al instante,
> no estás probando consistencia eventual: estás probando un fetch manual.

## C. Validación del formulario — bloqueante

| # | Entrada | Esperado |
|---|---|---|
| C1 | Nombre vacío, precio `10` | "el nombre no puede estar vacío" |
| C2 | Nombre `"   "` (espacios) | Ídem — hace `.trim()` |
| C3 | Precio vacío | "el precio es obligatorio" |
| C4 | Precio `abc` | "tiene que ser un número" |
| C5 | Precio `0` | "tiene que ser mayor que 0" |
| C6 | Precio `-5` | Ídem |
| C7 | Precio `10.999` | "admite máximo 2 decimales" |
| C8 | Precio **`1.99`** | **Acepta** — el caso que rompe la validación ingenua |
| C9 | Nombre de 256 caracteres | "máximo 255 caracteres" |
| C10 | Varios errores a la vez | Muestra todos juntos |

Ninguno debe llegar a la API: no debe haber error de red en consola.

## D. Consistencia eventual — la prueba que más importa

| # | Acción | Esperado |
|---|---|---|
| D1 | Guardar `50.00` | Total congelado al instante |
| D2 | Esperar ~2s | Sube **exactamente** 50, órdenes +1 |
| D3 | **Dos pestañas** abiertas, guardar en una | **Ambas** actualizan sin refrescar |
| D4 | Guardar 3 órdenes seguidas | Banner "3 órdenes guardadas" → desaparece al final |
| D5 | Con D4 a medias | El banner **no** desaparece antes de tiempo |

D5 es donde se rompía el contador: subía y nunca bajaba.

## E. Resiliencia

| # | Acción | Esperado |
|---|---|---|
| E1 | `docker compose stop backend` | Badge pasa a "respaldo por polling" (ámbar) |
| E2 | Con E1, guardar | Banner de error, no pantalla rota |
| E3 | `docker compose start backend` | Se recupera solo, sin recargar |
| E4 | Dejar quieto 30s | El total sigue al día sin tocar nada |

## F. Dashboard vacío

```bash
docker compose down -v && SEED_ON_START=false docker compose up -d
```

| # | Esperado |
|---|---|
| F1 | "Todavía no hay datos" + explicación, **NO** un 0 |
| F2 | Guardar la primera orden hace aparecer el total solo |

## G. Calidad visual

| # | Criterio |
|---|---|
| G1 | Foco visible en inputs y botones; se navega con Tab |
| G2 | El botón dice "Guardando…" mientras espera |
| G3 | Los importes se muestran siempre con 2 decimales |
| G4 | En móvil (375px) las métricas se apilan, no desbordan |
| G5 | Nada de `NaN`, `undefined`, `[object Object]` ni `$NaN` |

---

## Qué NO cubre esta lista

Comportamiento y datos sí. **Aspecto visual no**: que los colores contrasten,
que el espaciado sea agradable o que un importe se vea bien alineado es
judgment que requiere un ojo humano.

Sobre el timing de B3/B5: si el relay aplica antes de que mires, no loiscountes
como falla. La ventana es de ~1s y el badge indica si el stream está vivo.