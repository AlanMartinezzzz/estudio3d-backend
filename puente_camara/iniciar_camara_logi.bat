@echo off
REM Doble clic para empezar a transmitir.
set SERVIDOR=https://d3bvd36kte6l5e.cloudfront.net
set CAMARA_ID=4
set CAMARA_TOKEN=oPxbXc7vR-z6h5o-vjriWtS5MY6BIYtKmhoZjOxRSRc
cd /d %~dp0
echo INICIANDO CAMARA 1 espere un momento...
python -m pip install -q -r requirements.txt
python camara_puente.py --indice 1
pause