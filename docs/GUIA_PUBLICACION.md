# SpotKick: pasos para validar y publicar la demo del portfolio

Esta guía está escrita para PowerShell en Windows y el repositorio entregado. Incluye acciones que debes ejecutar tú; no afirma que Docker, el despliegue o GitHub Actions ya se hayan validado.

El objetivo es una demo que un equipo de ingeniería pueda abrir, jugar y revisar. El orden es: entorno reproducible → pruebas automáticas → pruebas manuales → repositorio público/CI → despliegue → presentación.

## 1. Localiza el proyecto y conserva su historial

Abre PowerShell y entra en la carpeta que contiene `compose.yaml` y `package.json`:

```powershell
Set-Location 'C:\Users\danie\Documents\Codex\2026-11-05\you-are-a-senior-full-stack-2\outputs\spotkick'
Get-ChildItem
git status
git log --oneline -10
```

Comprueba que aparecen `apps`, `packages`, `tests`, `infra`, `docs` y `.github`. El repositorio existente conserva los Conventional Commits; usa esta carpeta para publicar. El ZIP de código contiene los archivos, pero no el historial `.git`.

Si has movido el proyecto, sustituye la ruta por la nueva. Ejecuta los comandos siguientes desde su raíz.

## 2. Prepara las herramientas

### 2.1 Docker

Instala Docker Desktop siguiendo su [guía oficial para Windows](https://docs.docker.com/desktop/setup/install/windows-install/). Configura el motor de contenedores Linux y WSL 2 según las comprobaciones de su instalador. Reinicia Windows si lo solicita y abre Docker Desktop.

Después, abre una terminal nueva y ejecuta:

```powershell
docker --version
docker compose version
docker info
```

**Resultado esperado:** los tres comandos funcionan y `docker info` muestra información del servidor. Tener solo el cliente instalado no basta. Para el archivo de aceptación necesitas Compose **2.24.4 o posterior**, porque usa `!override` para reemplazar puertos; [referencia oficial](https://docs.docker.com/reference/compose-file/merge/).

Si aparece un error de conexión con el motor, abre Docker Desktop y espera a que termine de arrancar antes de continuar.

### 2.2 Node, pnpm y Git

Docker encapsula el runtime de la aplicación. Para lanzar Playwright desde Windows también usarás Node y pnpm:

```powershell
node --version
pnpm --version
git --version
```

Usa Node 22 o posterior; las imágenes y CI utilizan Node 22. El proyecto fija pnpm 11.25.0. Si pnpm no está instalado:

```powershell
npm install --global pnpm@11.25.0
```

Después:

```powershell
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
```

**Resultado esperado:** la instalación respeta `pnpm-lock.yaml` y Chromium queda disponible. No actualices dependencias para intentar ocultar un fallo. Conserva el primer error completo y corrige su causa.

## 3. Arranca una instalación Docker separada

He incluido `compose.acceptance.yaml`. Usa puertos **3100/3101**, un nombre de proyecto propio y volúmenes independientes de la demo normal. No modifica los puertos 3000/3001 del Compose original. La API secundaria del perfil de carga usa 3102.

En la misma ventana de PowerShell:

```powershell
$env:COMPOSE_PROJECT_NAME = 'spotkick-review'
$env:COMPOSE_FILE = 'compose.yaml;compose.acceptance.yaml'
$env:RAKE_BPS = '300'
$env:BOT_AFTER_MS = '5000'
$env:CHOICE_MS = '10000'
$env:REVEAL_MS = '3000'
$env:RESULT_MS = '1600'
```

En Windows, `;` separa los archivos de `COMPOSE_FILE`. Estas variables son de la terminal actual: al abrir otra debes repetir la configuración para operar sobre la misma instalación. [Docker documenta el aislamiento por nombre de proyecto](https://docs.docker.com/compose/how-tos/project-name/).

Primero valida la configuración:

```powershell
docker compose config --quiet
docker compose config --services
docker compose ps -a
```

**Resultado esperado:** `config --quiet` termina sin errores. Los servicios normales son `postgres`, `redis`, `migrate`, `api` y `web`. `api2` pertenece al perfil opcional de carga. Si ya existía `spotkick-review`, sus datos anteriores siguen en los volúmenes; no lo describas como una instalación vacía.

Construye y arranca:

```powershell
docker compose up --build -d
docker compose ps -a
docker compose logs --tail=100 migrate api web
```

La primera construcción puede tardar mientras descarga imágenes y dependencias. **No continúes si el build falla.**

Comprueba:

| Servicio | Estado esperado |
|---|---|
| `postgres` | Running/healthy |
| `redis` | Running/healthy |
| `migrate` | Exited (0), correcto para una tarea de una sola ejecución |
| `api` | Running/healthy |
| `web` | Running; comprueba además su respuesta HTTP |

Después:

```powershell
Invoke-RestMethod 'http://localhost:3101/health'
(Invoke-WebRequest 'http://localhost:3100' -Method Head).StatusCode
Start-Process 'http://localhost:3100'
```

**Resultado esperado:** health devuelve `ok: true`, la web responde 200 y el navegador conecta al arena. Si falla un puerto, identifica qué aplicación lo ocupa; no cierres procesos que no hayas identificado.

Para ver errores mientras pruebas:

```powershell
docker compose logs --follow api web
```

Usa una segunda terminal con las variables de Compose repetidas. Ctrl+C sale del seguimiento de logs; los contenedores iniciados con `-d` siguen funcionando.

**Punto de control:** aquí validas por primera vez el empaquetado Linux/Docker, que estaba pendiente. La preview nativa de Windows por sí sola no demuestra que estas imágenes funcionen.

## 4. Ejecuta las comprobaciones automáticas

### 4.1 Unit tests y TypeScript dentro de la imagen

La imagen de API del MVP conserva el workspace y las dependencias de desarrollo, así que puedes usar el mismo entorno Linux sin instalar PostgreSQL/Redis en Windows:

```powershell
docker compose run --rm --no-deps api node node_modules/vitest/vitest.mjs run --exclude 'tests/integration/**'
```

**Resultado esperado actual:** 7 tests aprobados. Se comprueban reglas, turnos pareados, puntuación, pagos, transiciones y primitivas de fairness/ledger.

Después ejecuta por separado:

```powershell
docker compose run --rm --no-deps api node node_modules/typescript/bin/tsc -p packages/shared/tsconfig.json --noEmit
docker compose run --rm --no-deps api node node_modules/typescript/bin/tsc -p apps/api/tsconfig.json --noEmit
docker compose run --rm --no-deps api node node_modules/typescript/bin/tsc -p apps/web/tsconfig.json --noEmit
```

**Resultado esperado:** los tres terminan sin errores. `--rm` elimina solo el contenedor temporal al terminar; `run` no publica los puertos del servicio por defecto.

### 4.2 Integración contra una base de pruebas

Crea una base específica dentro del PostgreSQL de aceptación:

```powershell
docker compose exec postgres createdb -U spotkick spotkick_test
```

Hazlo solo la primera vez. Si indica que ya existe, puedes reutilizarla; no es necesario borrar la base de la demo.

Lanza la suite:

```powershell
docker compose run --rm --no-deps -e DATABASE_URL=postgres://spotkick:spotkick@postgres:5432/spotkick_test -e REDIS_URL=redis://redis:6379/1 api node node_modules/vitest/vitest.mjs run tests/integration
```

Usa exactamente `spotkick_test`; la aplicación habitual de este stack usa la base `spotkick`. Redis `/1` separa las claves de esta suite de las de la demo `/0`; la suite no levanta un adaptador Socket.IO de pub/sub.

**Resultado esperado actual:** 6 tests aprobados. Deben verificar:

- 100 intentos concurrentes de apostar contra un wallet: exactamente 33 apuestas de 3.000 unidades con saldo inicial de 100.000.
- Los demás intentos fallan por fondos insuficientes, sin saldo negativo.
- 100 liquidaciones con duplicados producen exactamente 33 pagos.
- La suma global del journal es cero y los escrows liquidados quedan a cero.
- Actualizaciones, borrados, journals descuadrados y ampliaciones de una transacción sellada se rechazan.
- Los reveals incorrectos se rechazan; el partido completo se liquida una sola vez.
- Hay recuperación de snapshots, bot por cola Redis, timeout, devolución y verificaciones de solo.

Un test que falla por conexión, timeout o falta de recursos **no** cuenta como aprobado porque “el código parece correcto”. Corrige el entorno y repítelo.

### 4.3 Playwright contra la web Docker

Mantén la API/web de aceptación en marcha y configura el navegador de prueba:

```powershell
$env:WEB_URL = 'http://localhost:3100'
Remove-Item Env:PLAYWRIGHT_CHANNEL -ErrorAction SilentlyContinue
pnpm test:e2e
```

Eliminar esa variable solo selecciona el Chromium que acabas de instalar. No borra archivos. Si prefieres Chrome instalado, puedes usar `$env:PLAYWRIGHT_CHANNEL = 'chrome'`.

**Resultado esperado actual:** 2 tests aprobados:

1. Partida completa contra bot, recarga, verificación del transcript, saldo liquidado y journal.
2. Disparo de solo, fin de sesión/cash-out cuando corresponde y verificación en navegador.

No ejecutes k6 ni pongas otros humanos en cola mientras se prueba el bot: podrían emparejarse con el invitado del test. La duración varía por muerte súbita.

Para ver qué hace el navegador:

```powershell
pnpm exec playwright test --headed
```

Para abrir el último informe:

```powershell
pnpm exec playwright show-report
```

Si falla, conserva la captura y el trace de `test-results`, además del log de API. El [CLI oficial de Playwright](https://playwright.dev/docs/test-cli) documenta estos comandos.

## 5. Haz las pruebas manuales del producto

Usa perfiles nuevos cuando una prueba necesite un saldo inicial conocido. Un perfil normal y uno de incógnito representan invitados diferentes; dos pestañas normales del mismo perfil comparten wallet. Algunas ventanas de incógnito también comparten sesión entre sí, así que comprueba que aparecen nombres de invitado distintos.

Registra para cada caso: fecha, navegador, resultado, captura y mensaje de error si lo hay.

### M01 — Primera visita y lobby

1. Abre la web con un perfil limpio.
2. Espera a que el estado indique conexión.
3. Comprueba 1.000 S disponibles.
4. Cambia entre 5, 10, 25 y 50 S.
5. Revisa que el payout anunciado cambia de forma coherente.
6. Comprueba el aviso de dinero ficticio y juego responsable.

**Debe pasar:** no hay errores JavaScript, el saldo no cambia por seleccionar una apuesta y Find match se habilita al conectar. Un lobby vacío es válido; no debe inventar usuarios ni resultados.

### M02 — Partida completa contra bot

1. Elige 10 S y busca partida estando tú solo en cola.
2. Espera unos cinco segundos más el pequeño intervalo del worker.
3. Comprueba que se identifica al oponente como bot.
4. Juega ambas funciones: disparar y parar.
5. Completa las tres rondas; si empatas, continúa en muerte súbita.

**Debe pasar:** una oportunidad de disparo por jugador en cada ronda; goles de 1/2/3 puntos; muerte súbita resuelta solo después de completar ambos disparos. Una selección pendiente queda bloqueada al confirmarse.

**Dinero para un invitado nuevo:** saldo disponible 990 S al bloquear el stake; final 1.009,40 S si gana o 990 S si pierde. El bote de 20 S se reparte en 19,40 S al ganador y 0,60 S de comisión. La interfaz puede omitir ceros finales o usar formato numérico inglés.

### M03 — Humano contra humano

1. Abre dos perfiles con nombres de invitado distintos.
2. Selecciona la misma apuesta en ambos.
3. Pulsa Find match en ambos antes de que transcurran cinco segundos desde el primero.
4. Comprueba que ambos muestran el mismo partido y dos humanos.
5. En un intercambio, haz que shooter y keeper elijan ambos izquierda: debe haber parada.
6. En otro, elige zonas diferentes: debe haber gol.
7. Completa la partida y compara marcadores, ganador, payout y wallets en ambos perfiles.

**Debe pasar:** el resultado es el mismo en ambos clientes. Cada uno dispara y guarda. El stake se descuenta una vez por jugador. El perdedor no recibe el payout del ganador.

Si ya apareció un bot, esa sesión no sirve para validar PvP humano; termina la partida y repite con dos perfiles coordinados.

### M04 — Emparejamiento por stake

1. En dos invitados distintos, elige 5 S en uno y 25 S en el otro.
2. Busca simultáneamente.

**Debe pasar:** no se emparejan entre sí con apuestas distintas. Si nadie más espera, cada uno terminará recibiendo un bot con su stake.

### M05 — Recarga y duplicación de pestañas

1. Durante una partida, recarga el navegador.
2. Comprueba que sigue siendo el mismo invitado y el mismo partido.
3. Continúa y termina.
4. Recarga varias veces la pantalla de resultado y abre el journal.
5. En otra prueba, abre dos pestañas normales del mismo perfil y busca partida desde ambas.

**Debe pasar:** no aparece otro wallet ni otro cargo para el mismo stake; repetir la pantalla no vuelve a pagar. Dos pestañas de una identidad no crean un partido contra sí misma. Un segundo comando incompatible puede rechazarse sin alterar el saldo.

### M06 — Timeout y reconexión

1. En un turno PvP, no elijas nada durante diez segundos.
2. Comprueba que la partida avanza con una elección automática.
3. Termina y verifica el transcript de fairness.
4. En otra partida, corta temporalmente la red con DevTools o desconecta y reconecta.

**Debe pasar:** no queda bloqueada indefinidamente. Los plazos del servidor siguen corriendo, aunque tu navegador no esté conectado. Puedes volver a la misma partida; pueden haberse aplicado timeouts durante la ausencia. El caso se registra como excepción de timeout, no como un reveal original válido.

### M07 — Solo y cash-out

1. Abre Solo run con un invitado sin otro juego activo.
2. Guarda una captura del hash inicial y cambia el client seed.
3. Inicia una sesión de 10 S.
4. Dispara. Si hay parada, esa sesión acaba con pérdida de 10 S; inicia otra si quieres probar cash-out.
5. Si marcas, cobra el primer gol.

**Debe pasar:** no se puede cobrar antes de marcar. El primer gol de stake 10 S permite 14,85 S de cash-out; desde un wallet nuevo, saldo final 1.004,85 S. Un fallo termina en 990 S. Cobrar o recargar no duplica pagos.

No exijas que un disparo concreto sea gol: el resultado es aleatorio y no hay un modo de victoria forzada.

### M08 — Verificador positivo y negativo

1. Al terminar una sesión de solo, pulsa Verify this run.
2. Comprueba que aparece el hash original y el seed revelado.
3. Verifica: debe indicar coincidencia del seed.
4. Compara la zona calculada con la del keeper en el transcript para ese nonce.
5. Cambia un carácter del hash original y repite: debe indicar que no coincide.
6. Restaura los datos y vuelve a verificar.

**Debe pasar:** el cálculo es reproducible. Cambiar de nonce puede producir la misma zona por casualidad; solo hay tres zonas, así que eso no es un fallo.

### M09 — Reinicios y persistencia

Termina primero una partida y anota saldo, invitado y journal. Ejecuta:

```powershell
docker compose restart api
```

Recarga y comprueba que mantiene los datos. Después:

```powershell
docker compose restart redis
```

Puede haber errores transitorios durante la caída. Tras recuperarse, lobby/cola deben volver a funcionar y el saldo debe seguir derivándose de PostgreSQL.

Finalmente prueba detener y volver a arrancar la instalación, conservando los volúmenes:

```powershell
docker compose down
docker compose up -d
```

**Debe pasar:** el token del navegador vuelve a encontrar el mismo wallet y el resultado ya pagado no se paga de nuevo. No añadas `--volumes`: borraría los datos persistentes que esta prueba quiere comprobar.

Como prueba adicional, reinicia API durante un partido. Se debe recuperar; si el plazo venció durante el reinicio, puede haber una elección automática. No exijas que conserve exactamente los segundos o la fase que mostraba antes de caer.

### M10 — Responsive y teclado

1. Usa DevTools para revisar anchuras de 360, 390, 768, 1280 y 1440 px.
2. Revisa lobby, partido activo, resultado, solo, verificador y wallet.
3. Comprueba que no hay scroll horizontal ni botones cortados.
4. Navega con Tab y activa botones con Enter/Espacio.
5. Revisa que el foco sea visible y que los estados no se distingan solo por color.
6. Activa la preferencia de movimiento reducido y vuelve a disparar.
7. Revisa los diálogos: cierre, retorno de foco y navegación dentro del modal.

**Debe pasar para publicar:** poder usar los controles y leer los datos relevantes. La auditoría completa de accesibilidad, incluido el comportamiento de foco de modales, no se ha certificado. Anota y corrige cualquier fallo; no lo sustituyas por una afirmación genérica de “WCAG compliant”.

### M11 — Errores observables

1. Abre DevTools → Console y Network.
2. Ejecuta un partido y una sesión de solo.
3. Busca excepciones JavaScript, respuestas 500, errores de CORS y WebSocket.
4. Detén API brevemente y observa qué explica la pantalla al usuario.

**Debe pasar:** un error no provoca un wallet nuevo ni un saldo inventado. Los datos vuelven al reconectar. Un error de infraestructura durante una caída no es igual que un 500 repetido durante el recorrido normal; conserva los logs para distinguirlos.

## 6. Audita el ledger con SQL de solo lectura

Estas consultas van contra la base `spotkick` de la instalación de aceptación; no modifican datos.

### 6.1 Conservación global

```powershell
docker compose exec postgres psql -U spotkick -d spotkick -c "SELECT COALESCE(SUM(amount),0) AS total FROM ledger_entries;"
```

**Esperado:** `0`. Incluye las contrapartidas de emisión. Sumar solo los wallets de usuarios no es esta misma prueba.

### 6.2 Transacciones descuadradas

```powershell
docker compose exec postgres psql -U spotkick -d spotkick -c "SELECT t.id FROM ledger_transactions t LEFT JOIN ledger_entries e ON e.transaction_id=t.id GROUP BY t.id HAVING COALESCE(SUM(e.amount),0)<>0 OR COUNT(e.id)<2;"
```

**Esperado:** ninguna fila.

### 6.3 Cuentas gastables negativas

```powershell
docker compose exec postgres psql -U spotkick -d spotkick -c "SELECT a.id,COALESCE(SUM(e.amount),0) AS balance FROM accounts a LEFT JOIN ledger_entries e ON e.account_id=a.id WHERE a.kind<>'ISSUANCE' GROUP BY a.id HAVING COALESCE(SUM(e.amount),0)<0;"
```

**Esperado:** ninguna fila. La cuenta de emisión puede ser negativa por diseño.

### 6.4 Escrows de partidos finalizados

```powershell
docker compose exec postgres psql -U spotkick -d spotkick -c "SELECT m.id,COALESCE(SUM(e.amount),0) AS balance FROM matches m LEFT JOIN ledger_entries e ON e.account_id='escrow:'||m.id::text WHERE m.status IN ('SETTLED','ABANDONED') GROUP BY m.id HAVING COALESCE(SUM(e.amount),0)<>0;"
```

**Esperado:** ninguna fila. Un escrow de un partido activo sí puede tener dinero legítimamente.

## 7. Pruebas de carga

### 7.1 Instala k6

Si no lo tienes, la [documentación oficial de Grafana](https://grafana.com/docs/k6/latest/set-up/install-k6/) indica para Windows:

```powershell
winget install k6 --source winget
```

Abre otra terminal si hace falta para actualizar PATH y comprueba:

```powershell
k6 version
```

Vuelve a la raíz del proyecto. No ejecutes carga contra servicios compartidos o contra la futura demo pública mientras la utilizan visitantes.

### 7.2 Smoke con una API

La configuración de aceptación eleva el límite de creación de invitados solo en este entorno local. El Compose normal mantiene su límite por defecto.

```powershell
New-Item -ItemType Directory -Force test-results | Out-Null
k6 run -e API_URL=http://localhost:3101 -e VUS=4 -e DURATION=1s --summary-export test-results/k6-smoke.json tests/load/matches.js
```

`DURATION=1s` inicia las iteraciones durante un segundo; la finalización de partidos continúa durante el periodo de gracia. No significa que una partida dure un segundo.

**Esperado:** cuatro jugadores completan, `match_success` 100%, checks de saldo aprobados y cero fallos HTTP. Si aparece error de interfaz/protocolo, corrígelo antes de subir concurrencia.

### 7.3 Dos instancias de API

En la terminal con las variables Compose configuradas:

```powershell
docker compose --profile load up -d --build api2
docker compose --profile load ps
Invoke-RestMethod 'http://localhost:3102/health'
```

Después:

```powershell
k6 run -e API_URLS=http://localhost:3101,http://localhost:3102 -e VUS=12 -e DURATION=1s --summary-export test-results/k6-two-apis.json tests/load/matches.js
```

**Esperado:** los doce jugadores completan y cada wallet coincide con su liquidación. Como los clientes se reparten entre instancias, esto ejercita la coordinación compartida y los broadcasts mediante Redis.

Umbrales configurados en el script:

- `match_success > 95%`.
- `http_req_failed < 1%`.
- `match_duration p95 < 150000 ms`.

Ese p95 mide el partido completo, con animación y muerte súbita. No lo publiques como latencia de API. Una muerte súbita extraordinariamente larga puede superar el timeout; conserva el contexto en lugar de afirmar que todo fallo es de infraestructura.

### 7.4 Carga más larga

Si los smokes pasan, prueba diez jugadores durante un minuto:

```powershell
k6 run -e API_URLS=http://localhost:3101,http://localhost:3102 -e VUS=10 -e DURATION=1m --summary-export test-results/k6-one-minute.json tests/load/matches.js
```

En otra terminal con el mismo contexto Compose:

```powershell
docker stats
docker compose --profile load logs --tail=150 api api2
```

Registra CPU, memoria, errores y resultados. Repite las consultas SQL del paso 6 al terminar. No conviertas una pasada en “soporta miles de jugadores”: este ensayo no demuestra esa capacidad.

Detén la segunda API cuando acabes:

```powershell
docker compose --profile load stop api2
```

## 8. Publica el repositorio y comprueba CI

1. Crea un repositorio vacío en GitHub llamado `spotkick`.
2. Si vas a importar el historial local, no inicialices el remoto con otro README, licencia o `.gitignore`.
3. Desde la carpeta original con `.git`, comprueba:

```powershell
git status
git remote -v
git branch --show-current
```

4. Si no existe `origin`, añádelo reemplazando `TU_USUARIO`:

```powershell
git remote add origin https://github.com/TU_USUARIO/spotkick.git
git push -u origin HEAD
```

No uses `--force`. La rama actual puede llamarse `codex/spotkick`; subirla así conserva su historial. Puedes configurarla como rama predeterminada en GitHub. No hace falta renombrarla para ejecutar CI. Si ya existe `origin`, revisa que sea el repositorio correcto antes de cambiar nada.

GitHub documenta la [importación de un repositorio local](https://docs.github.com/en/migrations/importing-source-code/using-the-command-line-to-import-source-code/adding-locally-hosted-code-to-github).

5. Abre GitHub → repositorio → Actions → SpotKick CI.
6. Espera al resultado de todos los pasos: instalación, unitarios, tipos, integración, build, Playwright y construcción de imágenes Compose.
7. Si falla, abre el **primer** paso fallido y descarga el artefacto de Playwright cuando corresponda. Corrige, commitea y vuelve a subir.

**Debe pasar:** un run completamente verde para el commit que vas a presentar. No cuenta un verde de un commit anterior a tus últimos cambios. El workflow actual construye imágenes, pero la prueba manual del paso 3 es la que valida también el arranque Compose completo.

No subas `.env`, claves privadas, tokens de sesión ni credenciales de cuentas externas. Los valores de PostgreSQL presentes en el Compose son valores de la demo local; revisa la configuración del entorno público antes de desplegar.

## 9. Despliega la demo pública

Este paso requiere elegir un alojamiento; los comandos exactos dependen de él. El proyecto incluye contenedores, pero no un despliegue público ya provisionado.

Elige un entorno que soporte:

- API NestJS como proceso persistente con WebSockets.
- Web Next.js con la imagen de runtime suministrada.
- PostgreSQL y Redis accesibles solo por los servicios que los necesitan.
- Datos persistentes y migraciones antes de arrancar API.
- HTTPS/WSS y proxy con soporte para conexiones WebSocket.

Configura tus URLs reales, por ejemplo web en `https://spotkick.TU_DOMINIO` y API en `https://api-spotkick.TU_DOMINIO`. Son marcadores que debes sustituir por dominios tuyos:

```text
WEB_ORIGIN=https://spotkick.TU_DOMINIO
NEXT_PUBLIC_API_URL=https://api-spotkick.TU_DOMINIO
```

`NEXT_PUBLIC_API_URL` es una variable de **build**. Reconstruye la imagen web tras cambiarla. Cambiar solo el entorno de un contenedor web ya compilado no modifica el JavaScript descargado por el navegador.

Revisa también las conexiones y credenciales reales de PostgreSQL/Redis en la configuración de despliegue. No publiques sus puertos de base de datos a Internet por comodidad. Usa el HTTPS de la plataforma o del proxy configurado en ese entorno.

### Aceptación del despliegue

1. Abre la URL desde un perfil nuevo.
2. Abre DevTools → Network: las peticiones deben ir a tu API pública, nunca a `localhost`, `postgres` o `redis`.
3. Comprueba HTTPS/WSS, sin contenido mixto ni errores CORS.
4. Juega contra bot, recarga y verifica el wallet.
5. Haz una partida humana con otro dispositivo o perfil.
6. Termina una sesión solo y verifica el seed.
7. Repite desde un teléfono con datos móviles, fuera de tu Wi-Fi.
8. Revisa logs y conserva una captura del health de la API.

**No publiques el enlace en el portfolio si el visitante necesita instalar algo o conectarse a tu red local para jugar.**

## 10. Verifica Sentry, si lo activas

La integración está implementada. Falta aportar un proyecto/DSN y confirmar recepción real. Configura `SENTRY_DSN` en API/servidor y `NEXT_PUBLIC_SENTRY_DSN` para el navegador. Reconstruye web si cambias su DSN público.

Primero comprueba presencia del DSN sin imprimirlo:

```powershell
docker compose exec api node -e "console.log(process.env.SENTRY_DSN ? 'DSN configurado' : 'Falta DSN')"
```

Para comprobar ingestión del SDK de API, desde el entorno que ya tenga el DSN configurado:

```powershell
docker compose exec -w /app/apps/api api node -e "require('./dist/instrument'); const Sentry=require('@sentry/node'); Sentry.captureException(new Error('SpotKick portfolio ingestion test')); Sentry.flush(5000).then(ok=>{console.log(ok ? 'flush completado' : 'timeout'); process.exit(ok ? 0 : 1);});"
```

**Debe pasar:** ver el evento con ese mensaje en Sentry. Un `flush` exitoso sin DSN no demuestra ingestión, por eso debes comprobar el DSN y la recepción en el panel. Este comando prueba la ingestión del SDK en un proceso separado; no sustituye una prueba del filtro HTTP o del error boundary del navegador.

Para certificar también el flujo de navegador, provoca un error controlado en una versión de prueba y verifica su evento antes de retirar el disparador temporal. No habilites una ruta pública permanente que lance excepciones por comodidad.

## 11. Prepara la presentación del portfolio

### 11.1 README y evidencias

Cuando tengas los resultados reales:

1. Añade la URL pública al comienzo de README.
2. Añade el enlace al vídeo y un badge de CI de tu repositorio.
3. Actualiza `docs/VERIFICATION.md` con fecha, commit, versiones y comandos ejecutados.
4. Cambia el estado de Docker/CI/despliegue solo si se verificaron realmente.
5. Conserva los JSON de k6 que quieras publicar con sus condiciones de ejecución.
6. Actualiza las capturas si cambia la interfaz.
7. Revisa que todos los enlaces funcionen desde GitHub.

No subas traces con tokens ni capturas con credenciales. Revisa el material antes de hacerlo público.

### 11.2 Vídeo de 60–90 segundos

Guion sugerido:

| Tiempo | Qué mostrar |
|---|---|
| 0–10 s | Nombre, aviso de play money y entrada sin registro |
| 10–30 s | Emparejamiento, disparo y parada; identifica al bot si lo usas |
| 30–40 s | Recarga y vuelta a la misma partida |
| 40–55 s | Resultado, payout y ledger |
| 55–70 s | Solo y verificación del seed |
| 70–90 s | Diagrama, CI verde y prueba de concurrencia |

Puedes editar tiempos de espera, pero no simules resultados o saldos. Usa [el recorrido de cinco minutos](DEMO.md) para una entrevista en directo y [el caso de estudio](CASE_STUDY.md) como apoyo técnico.

## 12. Criterio final de publicación

Puedes considerar la demo lista para enseñar cuando puedas marcar:

- [ ] Una instalación Docker desde el código arranca sin arreglos manuales ocultos.
- [ ] 7 tests unitarios, 6 de integración y 2 de navegador pasan.
- [ ] PvP humano, bot, solo, timeout y recarga se han probado manualmente.
- [ ] Todos los wallets finales cuadran con el journal y no hay pagos duplicados.
- [ ] Las consultas SQL no devuelven inconsistencias.
- [ ] El smoke de dos API termina con resultados y saldos correctos.
- [ ] La interfaz funciona en escritorio y móvil; los controles son utilizables con teclado.
- [ ] El commit publicado tiene CI completamente verde.
- [ ] La demo pública funciona desde otra red, sin endpoints locales en el navegador.
- [ ] README tiene demo, vídeo, diagramas, evidencia y limitaciones claras.
- [ ] Si anuncias Sentry como verificado, has recibido los eventos de prueba reales.

Los bloqueantes son errores de dinero, fairness, recuperación, arranque o acceso público. Un detalle cosmético menor puede quedar documentado; un payout incorrecto no.

## 13. Cerrar las pruebas locales

Desde la terminal con el contexto `spotkick-review`:

```powershell
docker compose --profile load down
Remove-Item Env:COMPOSE_FILE -ErrorAction SilentlyContinue
Remove-Item Env:COMPOSE_PROJECT_NAME -ErrorAction SilentlyContinue
Remove-Item Env:WEB_URL -ErrorAction SilentlyContinue
```

Esto detiene la instalación de aceptación y conserva sus volúmenes. Al borrar el contexto de terminal evitas aplicar accidentalmente comandos posteriores a ese stack. El Compose normal vuelve a usar `docker compose up --build` y sus puertos 3000/3001.
