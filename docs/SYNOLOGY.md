# SpotKick en Synology DS918+

Objetivo: aprovechar el NAS existente sin contratar un VPS. El coste adicional de hosting sería cero; siguen existiendo consumo eléctrico, conexión doméstica y límites de disponibilidad. No se ha desplegado todavía en el NAS.

Synology incluye el DS918+ entre los modelos compatibles con [Container Manager](https://www.synology.com/en-in/dsm/packages/ContainerManager). Su CPU Intel es x86_64 y la memoria de fábrica es de 4 GB, según la [ficha oficial](https://global.download.synology.com/download/Document/Hardware/DataSheet/DiskStation/18-year/DS918%2B/enu/Synology_DS918_Plus_Data_Sheet_enu.pdf). La capacidad disponible depende de los demás servicios del NAS; todavía hay que comprobarla.

## Preparar las imágenes en el ordenador

Compilar Next.js en el ordenador evita competir con las tareas habituales del NAS. Desde el repositorio:

```powershell
docker build -f infra/docker/Dockerfile --target api -t spotkick-api:portfolio .
docker build -f infra/docker/Dockerfile --target web --build-arg NEXT_PUBLIC_API_URL=https://api.spotkick.danielgil.eu -t spotkick-web:portfolio .
docker save -o spotkick-images.tar spotkick-api:portfolio spotkick-web:portfolio
```

El ordenador debe generar imágenes Linux amd64 para el DS918+. El tar contiene dependencias e imágenes grandes: transfiérelo al NAS por la red local, sin añadirlo al repositorio. No contiene las credenciales del futuro entorno.

## Configuración en el NAS

1. Comprobar DSM, Container Manager/Docker, RAM libre y espacio disponible antes de instalar nada.
2. Crear una carpeta exclusiva de SpotKick, sin reutilizar volúmenes de otras aplicaciones. Importar `spotkick-images.tar` en Container Manager o con `docker load -i spotkick-images.tar` desde esa carpeta.
3. Copiar `compose.nas.yaml` y `.env.production.example` a la carpeta. Renombrar el segundo a `.env.production`, generar una contraseña aleatoria y sustituirla en los dos campos indicados. El archivo real debe quedar fuera de Git.
4. Revisar `docker compose version`; en instalaciones antiguas puede existir `docker-compose`. El archivo NAS es autónomo y no usa `!override`. Verificar su compatibilidad real con la versión instalada.
5. Validar y arrancar desde la carpeta del proyecto:

```sh
docker compose --env-file .env.production -f compose.nas.yaml config --quiet
docker compose --env-file .env.production -f compose.nas.yaml up -d
docker compose --env-file .env.production -f compose.nas.yaml ps
```

La API aplica migraciones con bloqueo de PostgreSQL al arrancar. PostgreSQL y Redis tienen volúmenes persistentes y no publican puertos. API y web solo escuchan en loopback del NAS: 3301 y 3300, respectivamente.

## HTTPS y dominio

Usar el reverse proxy de DSM, evitando instalar otro proxy. Configurar dos reglas:

| Origen HTTPS | Destino HTTP |
|---|---|
| `spotkick.danielgil.eu:443` | `127.0.0.1:3300` |
| `api.spotkick.danielgil.eu:443` | `127.0.0.1:3301` |

En la regla de API, añadir las cabeceras WebSocket desde la opción de DSM **Crear → WebSocket** y un timeout de al menos 120 segundos. Asignar certificados válidos a ambos nombres. [Guía oficial del reverse proxy de DSM](https://kb.synology.com/en-in/DSM/help/DSM/AdminCenter/system_login_portal_advanced).

Antes de cambiar DNS o router, comprobar IP pública/CGNAT, quién gestiona la zona DNS y los servicios ya publicados. Si hay IP pública, se puede dirigir únicamente el tráfico HTTPS necesario al reverse proxy. Si cambia la IP, hará falta actualizar DNS. Con CGNAT habrá que evaluar un túnel u otra salida; no se añade ningún servicio nuevo sin acordarlo.

No publicar el panel DSM, PostgreSQL ni Redis para servir esta demo. El dominio principal `danielgil.eu` continúa en Raiola. El portfolio puede enlazar al subdominio con botones **Jugar demo**, **Ver código** y **Caso técnico**.

## Aceptación

Probar desde datos móviles: certificado, HTTPS/WSS, partida completa contra bot, PvP, recarga con compromiso pendiente, solo y verificador, journal y recuperación tras reiniciar API. Registrar versión DSM, recursos consumidos y resultados en VERIFICATION.md después de ejecutarlo. Preparar y comprobar una copia de PostgreSQL fuera del volumen de la aplicación.

Pendiente: acceso al NAS, comprobación de recursos y red, importación, certificados, DNS y pruebas externas. La configuración local preparada no equivale a una demo pública desplegada.
