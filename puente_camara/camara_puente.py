"""
Puente de cámara — Estudio 3D
=============================
Corre en la PC (o Raspberry Pi) del taller que tiene la webcam conectada por USB.
Toma una foto cada ~0.5 s y la envía al servidor. NO hay que abrir puertos en el router:
la PC solo SALE a internet, igual que un navegador.

Uso (Windows / Linux / Mac):
    pip install -r requirements.txt
    python camara_puente.py --servidor https://TU-DOMINIO --camara 1 --clave LA_MISMA_CAMARA_TOKEN

    --camara  es el id_camara que aparece en el panel del negocio (tabla "camaras").
    --indice  0 es la primera webcam de la PC; prueba 1 si tienes otra integrada (laptop).
    --probar  solo abre una ventana con la imagen, para acomodar la cámara (no envía nada).

También se pueden poner en variables de entorno: SERVIDOR, CAMARA_ID, CAMARA_TOKEN.
"""
import argparse
import os
import sys
import time

import cv2
import requests


def abrir_camara(indice, ancho, alto):
    # En Windows, CAP_DSHOW abre la Logitech mucho más rápido que el modo por defecto
    backend = cv2.CAP_DSHOW if sys.platform.startswith("win") else cv2.CAP_ANY
    cam = cv2.VideoCapture(indice, backend)
    cam.set(cv2.CAP_PROP_FRAME_WIDTH, ancho)
    cam.set(cv2.CAP_PROP_FRAME_HEIGHT, alto)
    cam.set(cv2.CAP_PROP_BUFFERSIZE, 1)      # queremos la imagen más reciente, no una cola vieja
    if not cam.isOpened():
        return None
    return cam


def poner_hora(img):
    texto = time.strftime("%d/%m/%Y %H:%M:%S")
    cv2.putText(img, texto, (12, img.shape[0] - 14), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 0), 4, cv2.LINE_AA)
    cv2.putText(img, texto, (12, img.shape[0] - 14), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 1, cv2.LINE_AA)


def main():
    p = argparse.ArgumentParser(description="Envía la webcam del taller al servidor de Estudio 3D")
    p.add_argument("--servidor", default=os.environ.get("SERVIDOR", "http://localhost:8080"))
    p.add_argument("--camara", type=int, default=int(os.environ.get("CAMARA_ID", "1")))
    p.add_argument("--clave", default=os.environ.get("CAMARA_TOKEN", ""))
    p.add_argument("--indice", type=int, default=0, help="número de webcam en esta PC")
    p.add_argument("--ancho", type=int, default=1280)
    p.add_argument("--alto", type=int, default=720)
    p.add_argument("--fps", type=float, default=2.0, help="fotos por segundo que se envían")
    p.add_argument("--calidad", type=int, default=65, help="calidad JPEG 1-100 (menos = menos internet)")
    p.add_argument("--probar", action="store_true", help="solo mostrar la imagen en una ventana")
    a = p.parse_args()

    if not a.probar and not a.clave:
        sys.exit("Falta la clave (--clave o variable CAMARA_TOKEN). Debe ser igual a CAMARA_TOKEN del servidor.")

    url = f"{a.servidor.rstrip('/')}/api/camaras/{a.camara}/foto"
    sesion = requests.Session()
    sesion.headers.update({"Authorization": f"Bearer {a.clave}", "Content-Type": "image/jpeg"})
    pausa = 1.0 / max(a.fps, 0.2)
    cam, espera_error = None, 1

    print(f"Enviando cámara {a.indice} -> {url}  ({a.ancho}x{a.alto}, {a.fps} fps)  Ctrl+C para salir")
    while True:
        inicio = time.time()
        try:
            if cam is None:
                cam = abrir_camara(a.indice, a.ancho, a.alto)
                if cam is None:
                    raise RuntimeError(f"No se pudo abrir la webcam {a.indice} (¿la está usando otro programa?)")

            ok, img = cam.read()
            if not ok:
                cam.release(); cam = None
                raise RuntimeError("La webcam no devolvió imagen (¿se desconectó el USB?)")

            poner_hora(img)
            if a.probar:
                cv2.imshow("Prueba de cámara (q para salir)", img)
                if cv2.waitKey(1) & 0xFF == ord("q"):
                    break
                continue

            ok, jpg = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, a.calidad])
            r = sesion.post(url, data=jpg.tobytes(), timeout=10)
            if r.status_code == 403:
                sys.exit("El servidor rechazó la clave: revisa que --clave sea igual a CAMARA_TOKEN del .env")
            if r.status_code >= 400:
                raise RuntimeError(f"El servidor respondió {r.status_code}: {r.text[:200]}")
            if espera_error > 1:
                print("Conexión recuperada, transmitiendo.")
            espera_error = 1
        except KeyboardInterrupt:
            break
        except (requests.RequestException, RuntimeError) as e:
            print(f"[{time.strftime('%H:%M:%S')}] {e}. Reintento en {espera_error} s")
            time.sleep(espera_error)
            espera_error = min(espera_error * 2, 30)
            continue

        time.sleep(max(0, pausa - (time.time() - inicio)))

    if cam is not None:
        cam.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
