# Adiciones pendientes en platform-infra

Este documento es una propuesta para Daniel. No se ha editado `platform-infra` ni desplegado ningún stack del NAS. La demo Funnel conserva su imagen, datos y `PLATFORM_MODE=false`.

## Core verificado localmente; NAS pendiente

La integración se ha probado en el PC contra Core **v0.2.0**, commit `3fd3c707fc78e1f7096ed6559112106ee47d2009`, con contratos **0.3.0**, solo EUR. La referencia exacta está en `tests/fixtures/core030/release.json` y los resultados en `docs/core-v020-results.json`. Core todavía no está operativo en el NAS: no se ha probado ni desplegado staging. Las operaciones agrupadas de SpotKick en `/api/v1/spotkick/matches/:id/reserve|settle|release` siguen vigentes en 0.3.0 y preservan la liquidación atómica.

Los grants del jugador se crean con su bearer mediante `POST /v1/services/:clientId/activate` y clave idempotente estable. Las credenciales de máquina no conceden acceso a carteras de jugadores. Provisionar antes el cliente SpotKick con `spotkick:matches`; no editar manualmente los grants de usuario para suplir la activación. La autorización se limita a las carteras EUR de ese jugador. No cambiar la demo a modo plataforma.

## Imagen ya publicada y verificada

El [workflow 43071313828](https://github.com/Danimagnum/spotkick/actions/runs/43071313828) publicó y comprobó `ghcr.io/danimagnum/spotkick-api:sha-67f725871ad3ad232d9e5666d2b564b56a5d0fc3`, digest `sha256:49ecf040d61499725bdea1f196ce76e4faf70bca5004937f6622dc18b55638fc`. Es evidencia de publicación y arranque standalone, no una autorización para desplegar ni aceptación de Core. Elegir el commit más reciente que tenga también verify, secrets y publish-api en verde; hay una corrección posterior de la cola de salud. No usar `latest`.

## Perfil full del PC

La copia de `platform-infra/docker-compose.yml` revisada ya contiene un servicio `spotkick`, una base/rol `spotkick` y el target Prometheus `spotkick:3000`. Hay que actualizar esas entradas, no duplicarlas:

1. Sustituir el ejemplo `ghcr.io/danigil/spotkick:0.1.0` por `ghcr.io/danimagnum/spotkick-api:sha-<SHA completo verificado>`, preferiblemente por su digest publicado en el resumen de GitHub Actions. El workflow de SpotKick publica solo la API, para linux/amd64, después de verify y secrets. No publica `latest` ni despliega.
2. Declarar explícitamente `PLATFORM_MODE=false` para standalone; habilitar plataforma solo en un entorno privado que ya tenga el Core fijado y el cliente provisionado. Al habilitar plataforma, usar `SERVICE_NAME=spotkick`, `PORT=3000`, una base propia y las credenciales del entorno. Conservar el role/database existentes; no reinicializar el volumen para ejecutar scripts de init.
3. Para desplegar Core v0.2.0, provisionar el cliente `spotkick:matches` y permisos de escritura para las dos carteras EUR de los jugadores de prueba por el procedimiento real de Core. No inventar una ruta de permisos ni incluir secretos en Git. Activar entonces `PLATFORM_MODE=true`, `CORE_URL`, `CORE_CLIENT_ID`, `CORE_CLIENT_SECRET`, `CORE_JWKS_URL`, `CORE_ISSUER` y `CORE_AUDIENCE` con valores confirmados.
4. Revisar el transporte de Core. SpotKick exige HTTPS fuera de loopback para las llamadas al monedero y OAuth. El bridge genérico `http://core:3000` no sirve para ese adaptador. Usar un endpoint HTTPS interno verificable o compartir el namespace de Core y configurar su puerto real en `127.0.0.1`, asignando otro `PORT` a SpotKick. El issuer del JWT sigue siendo el valor exacto de Core y no se sustituye por la dirección de transporte.
5. `environment` explícito prevalece sobre `.env.spotkick`: ajustar también los valores heredados de `x-backend-env` si cambia el networking. Para Compose 1.28 usar `env_file: ['.env.spotkick']`; el formato `path/required` de la configuración moderna no es compatible.
6. Conservar PostgreSQL, Redis y Kafka fuera de interfaces públicas. El perfil actual publica algunos puertos en loopback del PC; no cambiar a `0.0.0.0` ni trasladar esos mappings al NAS.

## Staging del NAS

Añadir SpotKick al stack privado de staging con el **namespace ya existente**. No crear otra red bridge ni mover la demo. Antes de aplicarlo, confirmar nombre del contenedor ancla y los puertos ocupados: no están fijados en este documento.

Esqueleto para adaptar al archivo Compose 1.28 del staging (no es un despliegue ejecutado):

```yaml
version: '3.8'
services:
  spotkick:
    image: ${SPOTKICK_IMAGE:?set verified commit image or digest}
    platform: linux/amd64
    network_mode: service:${STAGING_NETWORK_ANCHOR:?set existing anchor service}
    env_file:
      - .env.spotkick-staging
    environment:
      NODE_ENV: production
      SERVICE_NAME: spotkick
      PORT: ${SPOTKICK_INTERNAL_PORT:?choose unused namespace port}
      PLATFORM_MODE: 'false'
    user: '1000:1000'
    read_only: true
    tmpfs:
      - /tmp:rw,nosuid,size=64m
    restart: unless-stopped
    healthcheck:
      test: [CMD, node, -e, "fetch('http://127.0.0.1:' + process.env.PORT + '/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 10s
      timeout: 5s
      retries: 18
      start_period: 120s
```

`DATABASE_URL`, `REDIS_URL` y, tras desbloquear Core, `CORE_URL`/JWKS y `KAFKA_BROKERS` usan `127.0.0.1` con los puertos reales del namespace. Las direcciones **advertised** de Kafka deben ser alcanzables desde ese mismo espacio: cambiar solo el bootstrap no basta. Kafka, PostgreSQL y Redis no llevan puertos publicados al exterior. Si es necesario publicar la API, el mapping se añade al contenedor ancla en loopback del host, nunca al servicio con `network_mode: service:...`.

Las claves Redis están prefijadas por `SERVICE_NAME`, pero la demo también usa `spotkick` por defecto. Dar al staging una instancia Redis independiente o una base Redis separada de la demo (p. ej. seleccionar un DB libre confirmado); no compartir sus colas/presencia. Mantener base y rol PostgreSQL propios del staging, sin reutilizar los volúmenes de la demo.

Con aproximadamente 1 GB libre no está acreditado que quepan Core, Kafka, PostgreSQL, Redis y SpotKick. Medir consumo en frío y estable en el staging existente antes de añadirlo. La carga de 200 partidas se ejecuta en el PC aislado; no en este NAS ni en la demo. Si se recrea el contenedor ancla hay que recrear los servicios que comparten su namespace, preservando los volúmenes.

## Prometheus y paneles

En el PC se mantiene el target existente. Si cambia la red del servicio, actualizarlo para que Prometheus llegue al namespace/puerto correcto. En el NAS con namespace compartido, usar `127.0.0.1:<puerto SpotKick>` desde Prometheus en ese namespace. Añadir etiquetas de entorno y servicio a los targets, nunca IDs de jugador/partida.

Consultas para un entorno a la vez:

```promql
max by (service, environment) (spotkick_active_matches)
sum by (service, environment) (spotkick_socket_connections)
histogram_quantile(0.95, sum by (le, service, environment) (rate(spotkick_resolution_duration_seconds_bucket[5m])))
sum by (service, environment, mode) (rate(spotkick_settlement_errors_total[5m]))
```

`spotkick_active_matches` es un recuento de la base compartida, por lo que **no se suma entre réplicas**. NaN indica que no pudo actualizarse; revisar también `up` y `/health/ready`. La latencia mide procesamiento de resolución y excluye espera del jugador/bloqueo previo/commit. Los contadores incluyen intentos repetidos y se reinician con el proceso.

Preparar los topics `spotkick.match.started.v1`, `spotkick.match.settled.v1` y `system.health.reported.v1` y ACLs de productor. Los consumidores deben deduplicar el ID del envelope en su inbox transaccional; la cabecera `event-id` se conserva y `correlation-id` facilita trazabilidad. El servicio no inventa suscripciones de negocio. Los informes de salud usan outbox una vez escritos; hasta entonces la cola en memoria tiene 64 muestras y no sobrevive al reinicio.

## Imagen y traslado compatible

La imagen GHCR se construye linux/amd64, sin attestations/SBOM adjuntos y con capas gzip y media types Docker. Esto no significa que ya esté validada su importación en Docker 20.10 del NAS. Para traslado offline desde el PC:

```sh
docker pull --platform linux/amd64 "$SPOTKICK_IMAGE"
docker image inspect "$SPOTKICK_IMAGE" --format '{{.Os}}/{{.Architecture}}'
docker save --output spotkick-api.tar "$SPOTKICK_IMAGE"
tar -tf spotkick-api.tar > spotkick-api.entries.txt
# Comprobar que existe manifest.json antes de comprimir.
gzip -c spotkick-api.tar > spotkick-api.tar.gz
sha256sum spotkick-api.tar.gz > spotkick-api.tar.gz.sha256
```

Usar gzip estándar (no zstd). Transferir archivo y checksum por el canal privado habitual; en el NAS ejecutar `sha256sum -c` antes de `gzip -dc spotkick-api.tar.gz | docker load`. Conservar el nombre y tag del manifest y verificar imagen/arquitectura tras la carga. Un checksum correcto acredita la transferencia, no la compatibilidad del runtime. No introducir credenciales GHCR en YAML; si el paquete requiere autenticación, usar un login privado con permiso de lectura de paquetes.

## Aceptación pendiente de aplicar por Daniel

Validar `docker-compose config`, backup/restauración en base aislada, recursos libres, arquitectura, arranque en frío y probes antes de dar tráfico. Cuando Core v0.2.0 esté operativo en ese entorno, repetir partida completa, respuestas perdidas en reserva/liquidación, cancelación y autoexclusión; reconciliar cargos, premio, comisión y holds. No fusionar por el mero hecho de publicar una imagen. La demo pública permanece standalone y su aceptación móvil con dos sesiones sigue siendo una comprobación separada.
