# Tablero de puntuaciones (hasta 6 marcadores simultáneos vs Sistema)

Web local con tablero interactivo que muestra hasta 6 marcadores al mismo tiempo en pantalla (Dany vs Sistema, Isaak vs Sistema, etc.).
Cada marcador tiene sus propias puntuaciones independientes, diseño con marco transparente (glassmorphism), fondo azul oscuro de alto contraste y paleta suave. Todos los dispositivos de tu red ven lo mismo en tiempo real.

## Probar rápido
    python3 server.py
Abre `http://localhost:8000` o `http://IP-DE-LA-RPI:8000` (obtén la IP con `hostname -I`).

## Siempre encendido (systemd)
Copia la carpeta a `/home/pi/tablero` (cambia `pi` en `tablero.service` si tu usuario es otro):

    sudo cp tablero.service /etc/systemd/system/
    sudo systemctl enable --now tablero

## Notas
- Datos en `data.json` (respáldalo si quieres). Si borras ese archivo, se crean 3 tableros de ejemplo.
- Cambiar puerto: `PORT=8080 python3 server.py`
- Sin contraseña: solo para tu red local.
