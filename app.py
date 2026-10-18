import os
import hashlib
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


def get_s3():
    # boto3 toma las credenciales del entorno / rol de IAM
    return boto3.client("s3", region_name=AWS_REGION, config=Config(signature_version="s3v4"))


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
        app.logger.warning("Token inválido: %s", e)
        return None


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
    token = token_de_la_peticion()
    usuario = usuario_autenticado(token)
    if usuario is None:
        return jsonify(error="Debes iniciar sesión"), 401

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
    token = token_de_la_peticion()
    if usuario_autenticado(token) is None:
        return jsonify(error="Debes iniciar sesión"), 401

    try:
        res = (cliente_con_token(token).table("archivos")
        .select("s3_key, nombre_archivo").eq("id_archivo", id_archivo).limit(1).execute())
    except Exception as e:
        app.logger.error("Error al consultar archivo: %s", e)
        return jsonify(error="No se pudo consultar el archivo"), 500

    if not res.data or not res.data[0].get("s3_key"):
        return jsonify(error="Archivo no encontrado"), 404

    fila = res.data[0]
    nombre = (fila.get("nombre_archivo") or "pieza.stl").replace('"', "")
    try:
        url = get_s3().generate_presigned_url(
            "get_object",
            Params={
                "Bucket": S3_BUCKET,
                "Key": fila["s3_key"],
                "ResponseContentDisposition": f'attachment; filename="{nombre}"',
            },
            ExpiresIn=300,  # 5 minutos
        )
    except (BotoCoreError, ClientError) as e:
        app.logger.error("Error al firmar URL: %s", e)
        return jsonify(error="No se pudo generar el enlace de descarga"), 502

    return jsonify(url=url)


@app.errorhandler(413)
def archivo_muy_grande(_e):
    return jsonify(error="El archivo supera el máximo permitido de 50 MB"), 413


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8080, debug=True)