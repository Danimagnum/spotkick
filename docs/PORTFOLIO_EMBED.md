# SpotKick en el portfolio

El juego puede quedar dentro de una página del portfolio. La página muestra un iframe y SpotKick se ejecuta en el NAS. Dos visitantes pueden buscar partida desde esa misma página. Quien esté solo puede elegir **Practice vs bot**.

## 1. Preparar una URL pública para el juego

Primero publica y verifica el servicio HTTPS de SpotKick. Si eliges Tailscale Funnel, la propuesta es usar el puerto público 443 para la web y el 8443 para la API, ambos en el nombre `.ts.net` del NAS. Los destinos son la web local de SpotKick en `127.0.0.1:3300` y su API local en `127.0.0.1:3301`. El panel de DSM y SSH quedan fuera de esas dos publicaciones. [Documentación de Funnel](https://tailscale.com/docs/features/tailscale-funnel)

Al preparar las imágenes, fija `NEXT_PUBLIC_API_URL` al endpoint HTTPS público de la API y `WEB_ORIGIN` a la URL de la web del juego, sin barra final. El origen de las peticiones del iframe es la web del juego. Para una demo abierta con invitados y práctica, usa el modo de fichas ficticias sin configurar `CORE_URL`.

Comprueba la URL desde datos móviles. La web debe abrir con certificado válido, la API debe devolver 200 en `/health` y Socket.IO debe abrir una conexión WSS. Verifica esto antes de colocar el iframe en el portfolio.

## 2. Añadir el juego a la página

1. Crea una sección o página de SpotKick en tu portfolio.
2. Pega el bloque siguiente en el HTML de la página. Si usas WordPress, puedes pegarlo en un bloque **HTML personalizado**.
3. Sustituye `https://TU-URL-PUBLICA/` en los dos lugares por la URL HTTPS verificada de la **web** de SpotKick.
4. Publica primero una vista previa. Si el portfolio usa una política CSP propia, comprueba que `frame-src` permita el origen de la demo.

```html
<section aria-labelledby="spotkick-title">
  <h2 id="spotkick-title">SpotKick</h2>
  <p>Duelo de penaltis en tiempo real. Busca un rival o practica contra el bot.</p>
  <iframe
    src="https://TU-URL-PUBLICA/"
    title="SpotKick, demo jugable de penaltis"
    loading="lazy"
    style="display:block;width:100%;height:clamp(720px,92dvh,1000px);border:0;border-radius:12px"
  ></iframe>
  <p><a href="https://TU-URL-PUBLICA/" target="_blank" rel="noopener">Abrir SpotKick en otra pestaña</a></p>
</section>
```

## 3. Probar desde el portfolio

1. En escritorio y móvil, abre la página del portfolio y prueba **Practice vs bot** hasta el resultado.
2. Abre la página desde dos dispositivos o perfiles de navegador distintos. Elige la misma apuesta ficticia en ambos y pulsa **Find match** a la vez. Comprueba que la partida muestra **Live PvP**.
3. Recarga la página durante una partida y comprueba que el juego se recupera.
4. Si un navegador restringe el almacenamiento dentro del iframe, usa el enlace de la pestaña nueva y comprueba si el fallo solo ocurre en la vista incrustada.

La plantilla queda preparada para cuando la URL pública esté activa.
