# Envío de emails y calentamiento del dominio

El sistema manda un email por cada compra (números, curso y link de descarga) y por cada participación gratuita. Con
cientos de miles de mails por mes, hay que cuidar dos cosas: **que el envío escale sin frenar el sitio** y **que los
mails lleguen a la bandeja de entrada y no a spam**.

## Cómo se envía

1. Al aprobarse el pago, el mail queda **en cola** dentro de la misma transacción (si el servidor se cae, no se pierde).
2. Un **worker** toma los pendientes **por lotes** (`EMAIL_BATCH_SIZE`), con varios envíos en paralelo
   (`EMAIL_CONCURRENCY`) y **sin pasar el límite por segundo** del proveedor (`EMAIL_RATE_PER_SEC`).
3. Si un envío falla, se reintenta con espera creciente (1, 5, 15 y 60 minutos, y 6 horas). Después del último intento
   queda **fallido** y el panel avisa, con el botón **"Reenviar todos los fallidos"**.
4. Cada envío se "toma" con una actualización condicional en la base: aunque haya dos workers o la API intente a la vez,
   **ningún mail sale dos veces**.

Un pico de compras solo agranda la cola; no demora las respuestas del sitio. Con el límite por defecto (5 por segundo)
el worker puede mandar unos 18.000 mails por hora, muy por encima de lo que se necesita para 400.000 por mes.

### Proveedor y límites del plan

El sistema envía por la **API HTTPS de Resend** (`RESEND_API_KEY`). Se eligió la API y no el SMTP porque Railway
bloquea el SMTP saliente en los planes Free, Trial y Hobby (solo lo permite el Pro), mientras que una llamada HTTPS
funciona en cualquier plan. El SMTP (`SMTP_URL`) sigue disponible como alternativa si se usa otro proveedor.

| Plan de Resend | Precio | Mails | Límite diario |
|---|---|---|---|
| Free | gratis | 3.000 por mes | **100 por día** |
| Pro | US$20 por mes | 50.000 por mes | sin límite |

Con el plan gratis, el día de lanzamiento los mails pasan de 100 y quedan en la cola reintentándose: **para vender de
verdad hay que contratar Pro**. Si el proveedor responde 429 (límite) o 5xx (caída), el envío falla y la cola lo
reintenta sola. Los clientes no dependen del mail para ver sus números: en "Mis números" entran con el DNI.

### Variables

| Variable | Por defecto | Qué hace |
|---|---|---|
| `EMAIL_RATE_PER_SEC` | `5` | Máximo de mails por segundo. **Ajustarlo al límite del plan del proveedor** (verificarlo en su documentación). `0` = sin límite |
| `EMAIL_BATCH_SIZE` | `50` | Pendientes que se toman por vuelta |
| `EMAIL_CONCURRENCY` | `5` | Envíos en paralelo dentro del lote (y conexiones SMTP reutilizadas) |
| `EMAIL_POLL_SECONDS` | `5` | Cada cuánto el worker busca pendientes |
| `EMAIL_WORKER` | `on` | `off` en la API cuando el envío corre en un servicio aparte |
| `EMAIL_IMMEDIATE` | `on` | Intento de envío apenas se aprueba la compra. `off` en la API cuando hay worker aparte |

Si en un momento hay mucha cola, el envío inmediato se saltea solo y el mail lo manda el worker.

### Worker aparte (recomendado en producción)

Ver "Servicio de envío" en [DEPLOY.md](DEPLOY.md). La API queda con `EMAIL_WORKER=off` y `EMAIL_IMMEDIATE=off`, y un
segundo servicio ejecuta `node src/worker.js` con las mismas variables.

## Que los mails lleguen a la bandeja de entrada

### Antes de enviar el primer mail real

- Usar un **dominio propio del cliente** (por ejemplo `sorteos.cliente.com.ar`) y un **subdominio dedicado** a este envío,
  para que su reputación no se mezcle con la del correo de la empresa.
- Verificar el dominio en el proveedor y publicar en el DNS los registros que indica:
  **SPF** y **DKIM** (los da el proveedor) y **DMARC** (empezar con la política `p=none` y un email para los reportes;
  pasar a `quarantine` cuando los reportes salgan limpios).
- `MAIL_FROM` con una dirección de ese dominio y `MAIL_REPLY_TO` apuntando a una casilla que alguien lea.
- Probar un envío real a Gmail y a Outlook y revisar en "Mostrar original" que figure SPF, DKIM y DMARC en **PASS**.
- Los grandes proveedores (Gmail, Yahoo) exigen autenticación y baja tasa de quejas a quien manda en volumen: conviene
  repasar sus guías vigentes para remitentes masivos antes de lanzar.

### Calentar el dominio

Un dominio nuevo que de golpe manda miles de mails se parece a un spammer y termina en spam. La reputación se construye
**subiendo el volumen de a poco**, con mails que la gente abre y no marca como spam. Como los mails de este sistema salen
al comprar (no se pueden "programar"), el calentamiento se hace **controlando la difusión**: no lanzar publicidad fuerte
hasta que el dominio venga con historial.

Guía orientativa (ajustar según cómo responda cada proveedor):

| Etapa | Volumen diario aproximado | Qué hacer |
|---|---|---|
| Días 1 a 3 | hasta 100 | Pruebas internas y primeras compras reales de conocidos |
| Días 4 a 7 | 100 a 300 | Difusión chica (clientes actuales, redes propias) |
| Semana 2 | 300 a 1.000 | Ampliar de a poco; revisar spam y rebotes cada día |
| Semana 3 | 1.000 a 3.000 | Primeras campañas |
| Semana 4 en adelante | 3.000 a 10.000 y más | Subir solo si las métricas están sanas |

Si en alguna etapa suben los rebotes o las quejas, **no subir el volumen**: volver a la etapa anterior hasta que se normalice.

### Qué vigilar

- **Rebotes** (direcciones que no existen): idealmente por debajo del 2 %. Los mails fallidos del panel suelen ser direcciones
  mal escritas: reenviarlos sin corregir el email no sirve (por eso "Reenviar" por compra permite cambiar la dirección).
- **Quejas de spam**: lo ideal es que sean casi nulas (el proveedor las informa).
- **Google Postmaster Tools**: registrar el dominio para ver su reputación en Gmail.
- El **contenido** ayuda: asunto claro y sin mayúsculas ni signos de exclamación en exceso, texto real además de botones,
  y un nombre de remitente reconocible. Los mails de este sistema ya salen con versión en texto y HTML.

### Si algo sale mal

- **Muchos mails en spam:** frenar la difusión, revisar SPF/DKIM/DMARC y pedirles a los compradores que busquen en spam y
  marquen "no es spam". La página de la compra y "Mis números" siempre permiten ver los números y descargar el curso aunque
  el mail no llegue.
- **El proveedor suspende la cuenta o frena el envío:** los mails quedan en cola y no se pierden; al normalizarse se envían
  solos. Si pasaron los reintentos, usar "Reenviar todos los fallidos".
