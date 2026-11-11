
DOCUMENTACION: [Uploading Estudio 3D — Documentación.pdf…]()


















@echo off
REM Plantilla. Copiala como iniciar_camara_logi.bat (o _pc) y pon tus valores.
REM Los archivos iniciar_camara*.bat estan en .gitignore: NUNCA se suben a GitHub.
set SERVIDOR=https://d3bvd36kte6l5e.cloudfront.net
set CAMARA_ID=ID-DE-LA-TARJETA
set CAMARA_TOKEN=PEGA-AQUI-LA-CLAVE-DEL-ENV
cd /d %~dp0
echo Revisando lo necesario (solo tarda la primera vez)...
python -m pip install -q -r requirements.txt
python camara_puente.py --indice 1
pause
