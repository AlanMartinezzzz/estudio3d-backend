import os
import hashlib
import re
import unicodedata
from urllib.parse import quote
from flask import Flask, jsonify, request, render_template
from flask_cors import CORS
import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError
from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()

app = Flask(__name__)
CORS(app)
app.config["MAX_CONTENT_LENGTH"] = 50 * 1024 * 1024  # Máximo 50 MB por archivo

# --- SUPABASE ---
# SUPABASE_KEY debe ser la clave anon/publishable (la misma que ve el navegador).
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# --- AWS S3 ---
S3_BUCKET = os.environ.get("S3_BUCKET")
AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")


_region_bucket = None


def region_del_bucket():
    """Región REAL del bucket. Un enlace firmado con otra región da error al abrirlo.
    Se pregunta a S3 una vez (necesita s3:GetBucketLocation); si no se puede, se usa AWS_REGION."""
    global _region_bucket
    if _region_bucket:
        return _region_bucket
    try:
        resp = boto3.client("s3", region_name="us-east-1").get_bucket_location(Bucket=S3_BUCKET)
        _region_bucket = resp.get("LocationConstraint") or "us-east-1"   # S3 devuelve None para us-east-1
        return _region_bucket
    except Exception as e:
        app.logger.warning("No se pudo detectar la región del bucket; se usa AWS_REGION=%s (%s)", AWS_REGION, e)
        return AWS_REGION


def get_s3():
    # boto3 toma las credenciales del entorno / rol de IAM
    region = region_del_bucket()
    # Se usa la dirección REGIONAL de S3: la global puede redirigir y entonces el enlace firmado deja de ser válido
    return boto3.client("s3", region_name=region, endpoint_url=f"https://s3.{region}.amazonaws.com",
                        config=Config(signature_version="s3v4", s3={"addressing_style": "virtual"}))


def disposicion_de_descarga(nombre):
    """Cabecera Content-Disposition segura: nombre ASCII de respaldo + nombre real en UTF-8 (RFC 5987)."""
    nombre = (nombre or "pieza.stl").strip() or "pieza.stl"
    ascii_ = unicodedata.normalize("NFKD", nombre).encode("ascii", "ignore").decode("ascii")
    ascii_ = re.sub(r'[^A-Za-z0-9._ -]', "_", ascii_).strip() or "pieza.stl"
    return f"attachment; filename=\"{ascii_}\"; filename*=UTF-8''{quote(nombre, safe='')}"


@app.after_request
def sin_cache_en_api(resp):
    # Las respuestas de /api/ (sobre todo los enlaces firmados, que caducan) nunca deben guardarse en caché
    if request.path.startswith("/api/"):
        resp.headers["Cache-Control"] = "no-store"
    return resp


def token_de_la_peticion():
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth.split(" ", 1)[1].strip()
    return None


def usuario_autenticado(token):
    """Pregunta a Supabase quién es el dueño del token. Devuelve el usuario o None."""
    if not token:
        return None
    try:
        res = supabase.auth.get_user(token)
        return res.user if res and res.user else None
    except Exception as e:
        app.logger.warning("Supabase rechazó el token (%s): %s", type(e).__name__, e)
        return None


def autenticar():
    """Devuelve (token, usuario, error). El mensaje de error dice QUÉ falló, para no adivinar."""
    token = token_de_la_peticion()
    if not token:
        app.logger.warning("Petición a %s sin encabezado Authorization (¿lo está quitando CloudFront?)", request.path)
        return None, None, (jsonify(error="El servidor no recibió tu sesión (no llegó el encabezado Authorization)"), 401)
    usuario = usuario_autenticado(token)
    if usuario is None:
        return token, None, (jsonify(error="Supabase no aceptó tu sesión. Cierra sesión y vuelve a entrar."), 401)
    return token, usuario, None


def cliente_con_token(token):
    """Cliente de Supabase que actúa COMO el usuario, así las reglas RLS siguen aplicando."""
    c = create_client(SUPABASE_URL, SUPABASE_KEY)
    c.postgrest.auth(token)
    return c


@app.get("/")
def home():
    return render_template("index.html")


@app.get("/health")
def health():
    return jsonify(status="healthy")


@app.get("/api/config")
def get_config():
    return jsonify({"supabaseUrl": SUPABASE_URL, "supabaseKey": SUPABASE_KEY})


# --- S3: SUBIR UN .STL ---
# El precio se calcula en el navegador con las tarifas de la base de datos.
# Aquí solo se guarda el archivo, y se devuelve su ruta y su huella (SHA-256).
@app.post("/api/archivos")
def subir_archivo():
    token, usuario, fallo = autenticar()
    if fallo:
        return fallo

    archivo = request.files.get("archivo")
    if archivo is None or archivo.filename == "":
        return jsonify(error="Falta el archivo (campo 'archivo')"), 400
    if not archivo.filename.lower().endswith(".stl"):
        return jsonify(error="Solo se aceptan archivos .stl"), 400
    if not S3_BUCKET:
        return jsonify(error="Falta configurar S3_BUCKET en el servidor"), 500

    contenido = archivo.read()
    if not contenido:
        return jsonify(error="El archivo está vacío"), 400

    # La huella identifica el CONTENIDO. Mismo archivo => misma huella => misma ruta en S3,
    # así nunca se guardan copias repetidas en el bucket.
    huella = hashlib.sha256(contenido).hexdigest()
    clave = f"stl/{usuario.id}/{huella}.stl"

    try:
        get_s3().put_object(
            Bucket=S3_BUCKET,
            Key=clave,
            Body=contenido,
            ContentType="model/stl",
            ServerSideEncryption="AES256",
        )
    except (BotoCoreError, ClientError) as e:
        app.logger.error("Error al subir a S3: %s", e)
        return jsonify(error="No se pudo guardar el archivo en AWS S3"), 502

    return jsonify(mensaje="Archivo guardado", clave=clave, hash=huella), 201


# --- S3: URL TEMPORAL PARA DESCARGAR ---
# Se lee la fila con el token del usuario: si RLS no le deja ver ese archivo
# (no es suyo y no es el negocio), la consulta vuelve vacía y no se firma nada.
@app.get("/api/archivos/<int:id_archivo>/url")
def url_descarga(id_archivo):
    token, usuario, fallo = autenticar()
    if fallo:
        return fallo

    try:
        res = (cliente_con_token(token).table("archivos")
        .select("s3_key, nombre_archivo").eq("id_archivo", id_archivo).limit(1).execute())
    except Exception as e:
        app.logger.error("Error al consultar archivo: %s", e)
        return jsonify(error="No se pudo consultar el archivo"), 500

    if not res.data or not res.data[0].get("s3_key"):
        return jsonify(error="Archivo no encontrado"), 404

    if not S3_BUCKET:
        return jsonify(error="Falta configurar S3_BUCKET en el servidor"), 500

    fila = res.data[0]
    try:
        s3 = get_s3()
        # Comprobamos que el servidor SÍ puede leer el archivo antes de entregar el enlace.
        # Así un problema de permisos se ve aquí con un mensaje claro y no como una página de error de S3.
        s3.head_object(Bucket=S3_BUCKET, Key=fila["s3_key"])
        url = s3.generate_presigned_url(
            "get_object",
            Params={
                "Bucket": S3_BUCKET,
                "Key": fila["s3_key"],
                "ResponseContentDisposition": disposicion_de_descarga(fila.get("nombre_archivo")),
            },
            ExpiresIn=300,  # 5 minutos
        )
    except ClientError as e:
        codigo = e.response.get("Error", {}).get("Code", "")
        app.logger.error("S3 rechazó la lectura de %s (código %s): %s", fila.get("s3_key"), codigo, e)
        if codigo in ("404", "NoSuchKey", "NotFound"):
            return jsonify(error="El archivo ya no está guardado en S3"), 404
        if codigo in ("403", "AccessDenied", "Forbidden"):
            return jsonify(error="El servidor no tiene permiso para leer este archivo en S3 "
            "(falta s3:GetObject en el rol de IAM, o el archivo no existe)"), 502
        return jsonify(error=f"S3 respondió con un error ({codigo or 'desconocido'})"), 502
    except BotoCoreError as e:
        app.logger.error("Error al preparar la descarga: %s", e)
        return jsonify(error="No se pudo generar el enlace de descarga (revisa las credenciales de AWS del servidor)"), 502

    return jsonify(url=url)


@app.errorhandler(413)
def archivo_muy_grande(_e):
    return jsonify(error="El archivo supera el máximo permitido de 50 MB"), 413


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8080, debug=True)