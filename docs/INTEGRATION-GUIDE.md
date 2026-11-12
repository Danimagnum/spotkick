# Integración de SpotKick con Platform Core

Esta guía describe la integración ejecutada, para reutilizar el proceso en los demás servicios. El contrato instalado es **@danigil/platform-contracts 0.3.0**. Core probado: **v0.2.0**, commit `3fd3c707fc78e1f7096ed6559112106ee47d2009`, con la referencia completa en [release.json](../tests/fixtures/core030/release.json). Solo EUR.

La certificación se hace en el PC contra esa imagen. Core no está operativo en el NAS. La demo pública sigue standalone y no se ha redeplegado.

## 1. Fijar las versiones y preservar standalone

Mantener repositorio, imagen y base de datos propios. Fijar exactamente el paquete en la API y en las herramientas de tests; conservar el lockfile. El paquete incluye cliente, tipos, validadores, contratos JWT y herramientas Kafka. No copiar sus esquemas al repositorio consumidor.

`PLATFORM_MODE` ausente o `false` selecciona identidad y libro locales, incluso con CORE_URL presente. Solo `true` habilita Core/Kafka y requiere configuración completa. La falta de Core nunca selecciona automáticamente el libro local. La prueba de imagen configura una CORE_URL inaccesible y confirma que el modo explícito false sigue arrancando como demo.

Antes de cambiar de modo, drenar partidas y operaciones pendientes del modo anterior. Separar bases, credenciales y Redis de demo y plataforma; compartir un prefijo Redis entre ambas mezcla colas y presencia.

## 2. Leer el contrato y el servidor exactos

Comparar el OpenAPI publicado con los controladores del commit de Core; un paquete instalado no despliega endpoints. En 0.3.0 las operaciones agrupadas históricas de SpotKick siguen disponibles:

| Operación del paquete | Ruta bajo /api/v1 | Resultado |
|---|---|---|
| reserveMatch | /spotkick/matches/{matchId}/reserve | HTTP 201, ambas reservas |
| settleMatch | /spotkick/matches/{matchId}/settle | HTTP 200, payout y rake |
| releaseMatch | /spotkick/matches/{matchId}/release | HTTP 200, liberación |

SpotKick ya usa estas rutas, no /v1/wallet para escribir dinero. Identidad y activación permanecen en sus rutas reales /v1/auth/login, /v1/me y /v1/services/{clientId}/activate. No añadirles /api por analogía.

No sustituir el settle agrupado por capturas y transferencias separadas: una caída entre llamadas permitiría un pago parcial. Los nuevos settleHold/settleHoldGroup e intenciones de 0.3.0 son otra API; SpotKick no confunde matchId con groupId ni afirma usar su ventana de gracia. La expiración de los holds agrupados se conserva; una decisión no liquidable queda para reconciliación, sin inventar crédito local.

## 3. Provisionar el cliente; activar grants con el jugador

Registrar el cliente de SpotKick y su secreto del lado servidor mediante el procedimiento de Core. Scope necesario para este flujo: spotkick:matches. El usuario de pruebas recibe KYC y fondos sintéticos solo dentro del stack de test; esas escrituras fixture no son instrucciones de producción.

Flujo real de entrada:

1. Verificar el JWT del jugador con createAuthVerifier: RS256, issuer/audience configurados y JWKS confiable. No derivar el JWKS de cabeceras del token. Se conserva caché de claves y rotación; rechazar identidades de máquina.
2. Consultar /v1/me con el mismo bearer para comprobar sujeto y sesión revocable.
3. Llamar a POST /v1/services/{CORE_CLIENT_ID}/activate con **ese bearer del jugador**, cuerpo vacío y una Idempotency-Key estable. El cliente deriva la clave de clientId/playerId mediante SHA-256; nunca del secreto.
4. Validar serviceId, grants EUR y canWrite=true. Si la activación falla o devuelve otra moneda, rechazar la entrada. Compartir solicitudes concurrentes y repetir fallos con la misma clave.
5. Obtener tokens de máquina por createClientCredentialsProvider solo para las operaciones de servicio. No usar un token de máquina para concederse acceso a carteras de jugadores.

La prueba real exige 403 sin grant, confirma que no existía ninguna fila de autorización del jugador y verifica las filas EUR creadas por su sesión. No inserta manualmente grants de jugadores. Los unitarios comprueban rechazos, caída del endpoint, moneda incorrecta y reintento con clave idéntica.

Los access tokens duran lo que indique Core. La demo actual conserva el access token de jugador en la pestaña y pide iniciar sesión al expirar; no hay renovación transparente del portal implementada ni se almacena su refresh token en una URL. Los secretos de máquina nunca van en NEXT_PUBLIC_* ni en el navegador.

## 4. Usar el cliente de dinero y decisiones duraderas

CoreClient usa WalletClient y WalletRequest/WalletResponse del paquete. La lectura de balance también valida balanceSchema y exige EUR. El adaptador local de movimientos y perfil corresponde a endpoints de Core fuera del OpenAPI de monedero; no duplica los contratos de escritura ni de claims.

Antes de la petición, SpotKick persiste la acción y su cuerpo determinista en el estado de partida. Claves:

- match:{id}:reserve
- match:{id}:settle
- match:{id}:release

La reserva agrupa ambos jugadores; no hay dos commits independientes. El motor conserva el ganador decidido antes de llamar a Core. Una respuesta perdida significa resultado ambiguo: repetir método, ruta, cuerpo y clave originales. No liberar fondos para compensar una liquidación cuyo resultado se desconoce.

Los reintentos de dinero los programa el estado persistido, con backoff y Retry-After, sin dormir dentro del cliente mientras se sostiene el bloqueo de la partida. La renovación de un token de máquina 401 se permite una vez con el mismo comando. 409 idempotency_conflict exige reconciliación; nunca cambiar la clave para forzar otro cargo. Las respuestas exitosas inválidas siguen tratándose como ambiguas.

El settlementId publicado es la identidad estable del comando confirmado. La respuesta agrupada no contiene ese campo. No fabricarlo como si Core lo hubiera devuelto.

La cancelación libera ambos holds; el motor bloquea el estado y no puede confirmar premio y devolución para la misma partida. En un fallo de escritura local tras reserva se reconcilia el estado antes de solicitar compensación. Una decisión ya aceptada no se sustituye por dinero local durante una caída de Core.

## 5. Outbox transaccional y Kafka tipado

El cambio de estado confirmado y los eventos spotkick.match.started.v1 / spotkick.match.settled.v1 se insertan en la misma transacción PostgreSQL. Cada fila conserva el envelope completo, ID, timestamp, correlación y clave de agregado. La publicación usa ValidatedProducer.sendEvent para no regenerar la identidad al reintentar.

Marcar publicado solo tras la confirmación del broker. Un fallo después de publicar pero antes del commit puede duplicar el envío: la entrega es al menos una vez. Las claves Kafka agrupan la partida; los headers event-id y correlation-id acompañan al envelope. El ID del envelope es la identidad contractual de deduplicación.

El relay mantiene orden pendiente por topic/agregado, reclama filas con SKIP LOCKED y reprograma fallos; un agregado bloqueado no detiene los demás.

## 6. Consumir sin aplicar dinero dos veces

WalletEvents consume core.wallet.transaction_posted.v1 mediante ValidatedConsumer. En una sola transacción inserta (consumer,event_id) en platform_inbox y genera un aviso interno walletChanged para un usuario Core conocido. Un ID repetido no genera un segundo aviso. Los eventos sin usuario local o de otra moneda no inventan cuentas ni saldos.

El consumidor no escribe el libro local. La vista vuelve a leer el balance autoritativo de Core. Los avisos usan el outbox Socket.IO existente y llegan por el adaptador Redis a ambas instancias. Repetir una entrega de transporte puede repetir una lectura, nunca un cargo.

El kit gestiona validación, tres intentos, heartbeats, DLQ y commit de offsets tras éxito o DLQ confirmada. Provisionar el topic y core.wallet.transaction_posted.v1.dlq.{groupId}; groupId es SERVICE_NAME-core-wallet-v1. El replay operativo debe preservar los bytes y el ID original. No hay un daemon de replay automático ni una política de retención/destrucción aplicada a inbox/outbox por esta PR.

La prueba con Kafka real envía el mismo evento dos veces, comprueba un inbox y un aviso, verifica ausencia de apuntes locales y envía JSON inválido a la DLQ. El test de la imagen exacta también verifica que los eventos del worker real de Core llegan al inbox/aviso de SpotKick.

## 7. Salud, métricas y apagado

/health/live solo comprueba el proceso. /health/ready exige PostgreSQL/Redis y, en plataforma, Core/Kafka y consumidor listo. Los fallos devuelven 503 sin dejar de responder a liveness. /metrics devuelve Prometheus:

- spotkick_active_matches: global por base/modo; agregar con max entre réplicas.
- spotkick_socket_connections: local; sumar entre réplicas.
- spotkick_resolution_duration_seconds: procesamiento de resolución, sin espera del jugador o bloqueo previo; incluye intentos revertidos.
- spotkick_settlement_errors_total: intentos fallidos, incluidos reintentos.

Los contadores se reinician con el proceso. Las lecturas de partidas activas comparten consulta/caché breve; NaN señala indisponibilidad, no saldo ni actividad cero.

system.health.reported.v1 se guarda al arrancar, ante cambios observados y cada 30 segundos. Si no puede escribir outbox, conserva hasta 64 muestras en memoria con sus métricas originales y drena al recuperarse. Esa fase previa al outbox no sobrevive al reinicio. El apagado detiene timers, intake, suscripción y conexiones sin borrar datos.

## 8. Reproducir y falsar las pruebas

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
# Con DATABASE_URL y REDIS_URL de un entorno desechable:
pnpm test:integration
pnpm test:contract
pnpm test:mutations
# Imagen privada descargada/cargada por su digest antes:
pnpm test:core:mutations
pnpm test:secrets
```

El runner de Core verifica etiquetas, arquitectura, RepoDigest y /health/live antes de certificar el ensayo. Crea únicamente el stack compose.core-test.yaml, ligado a loopback del PC. Comprueba sufijos _test y reconstruye clientes/motores entre fallos. Las bases y volúmenes se preservan; el runner los detiene al finalizar. El ensayo cubre partida, tres respuestas perdidas, caída tras decisión, replays concurrentes, conflicto de ganador, devolución y autoexclusión por sesión.

Los tests no se consideran demostrados solo porque pasen: las mutaciones deben provocar fallos de aserción y siempre restauran las fuentes. Dos mutaciones adicionales se ejecutan contra la imagen real: quitar activación y cambiar la clave tras una reserva ambigua. Ver los scripts, [evidencia de Core](core-v020-results.json) y [registro de verificación](VERIFICATION.md).

CI ejecuta unitarios, integración real PostgreSQL/Redis/Kafka, contrato, mutaciones, build, Playwright y construcción de imágenes. El test privado de Core se certifica con el runner local y se documenta aparte; no se presenta un skip en CI como una ejecución real.

## 9. Medir antes de generalizar capacidad

La prueba de 200 pares usa 400 VUs, dos APIs, base nueva y muestreo SQL/Socket cada 250 ms. Tras corregir emparejamiento serial y polling antes del deadline alcanzó 200 partidas activas, 400 conexiones y p95 52,78 s; no hubo errores ni timeout exchanges y el libro sumó cero.

Los datos antes/después y el entorno exacto están en README y load-200-*.json. El primer turno espera una barrera de 25 s y CHOICE_MS=60000; el p95 incluye cola/barreras. Es standalone: no es una cifra de capacidad de Core, del NAS ni de la configuración de diez segundos. Ejecutar K6_BIN=<ruta> pnpm test:load:200 según la sintaxis del shell; el runner conserva el resultado, crea otra base y mata solo sus propios procesos API.

## 10. Publicar, desplegar y distinguir lo pendiente

La CI escanea historial y archivos actuales con Gitleaks fijado por digest y dos controles sintéticos. La única excepción permite un tag público exacto en dos documentos históricos; no excluye paths o reglas enteros. No escribir tokens ni secretos en evidencia/logs.

Después de verify/secrets publica la API en GHCR con tag de commit, linux/amd64, Docker media types, gzip y sin attestations. Verifica el manifiesto remoto y arranque no-root/read-only en standalone. El frontend requiere su propio build con la URL de API del navegador.

No se ha editado platform-infra. [platform-infra-additions.md](platform-infra-additions.md) enumera qué aplicar después: imagen fijada, configuración por entorno, grants de sesión, topics/ACL/DLQ, target Prometheus, red compartida y márgenes de arranque del NAS, y comprobación SHA-256 antes de importar el tar.gz con manifest.json.

Verificado localmente no significa desplegado. Permanecen separados la importación/recursos/rollback del NAS, la aceptación física desde móvil con dos sesiones y el acceso público Funnel. La demo sigue con su imagen standalone; no se usa para carga ni pruebas contra Core.
