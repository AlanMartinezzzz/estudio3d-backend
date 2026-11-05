# Cámara en vivo (Logitech 720p)

```
Webcam USB ──> PC del taller ──(fotos JPEG, HTTPS)──> servidor EC2 ──> página del cliente
               camara_puente.py      POST /api/camaras/<id>/foto        GET /api/camaras/<id>/en-vivo
```

La PC del taller solo **envía**; no hay que abrir puertos ni tocar el router.

## 1. Supabase (una vez)
Ejecuta `supabase_camaras.sql` en **SQL Editor**. Agrega `camaras.id_archivo` y la regla para que cada
cliente vea solo la cámara de sus piezas. Lee el paso 3 del archivo (comprobar RLS).

## 2. Servidor (una vez)
En el `.env` del EC2 agrega una clave larga inventada:
```
CAMARA_TOKEN=pon-aqui-una-clave-larga-y-rara
```
Haz push a `main` (el deploy reinicia el contenedor y toma el `.env`).

## 3. PC del taller
1. Instala Python 3 (en Windows marca "Add Python to PATH").
2. En esta carpeta: `pip install -r requirements.txt`
3. Acomoda la cámara: `python camara_puente.py --probar` (ventana con la imagen, `q` para salir).
4. En el panel del negocio → **Cámaras** → registra la cámara y fíjate en su **ID**.
5. Edita `iniciar_camara.bat` (servidor, ID y la misma `CAMARA_TOKEN`) y dale doble clic.
   Para que arranque solo al prender la PC: `Win+R` → `shell:startup` → pon ahí un acceso directo al `.bat`.

## 4. Uso diario
En **Cámaras**, elige en la lista la pieza que se está imprimiendo. Al cliente dueño de esa pieza le aparece
el botón **En vivo** en *Mis archivos*. Al terminar, elige "Sin pieza asignada".

## Ajustes
- `--fps 1` o `--calidad 50` si el internet del taller es lento.
- Si la laptop tiene cámara integrada y abre esa, usa `--indice 1`.
- Ningún otro programa (Zoom, Cámara de Windows, OBS) puede estar usando la webcam al mismo tiempo.
