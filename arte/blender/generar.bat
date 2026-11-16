@echo off
rem Genera el caballo (GLB) y las vistas previas con Blender en modo fondo.
rem Doble clic en este archivo. El registro queda en arte\blender\ultimo_log.txt
setlocal enabledelayedexpansion
cd /d "%~dp0"
set "BLENDER="

where blender >nul 2>nul && set "BLENDER=blender"
if not defined BLENDER (
  for /d %%D in ("C:\Program Files\Blender Foundation\Blender*") do if exist "%%D\blender.exe" set "BLENDER=%%D\blender.exe"
)
if not defined BLENDER if exist "C:\Program Files (x86)\Steam\steamapps\common\Blender\blender.exe" set "BLENDER=C:\Program Files (x86)\Steam\steamapps\common\Blender\blender.exe"
if not defined BLENDER if exist "C:\Program Files\Steam\steamapps\common\Blender\blender.exe" set "BLENDER=C:\Program Files\Steam\steamapps\common\Blender\blender.exe"

if not defined BLENDER (
  echo No encontre Blender. Abri este archivo con el Bloc de notas y escribi la ruta de blender.exe en la linea "set BLENDER=".
  echo No encontre Blender > ultimo_log.txt
  pause
  exit /b 1
)

echo Usando: !BLENDER!
echo Generando caballos... (puede tardar uno o dos minutos)
"!BLENDER!" -b --factory-startup -P generar_caballos.py > ultimo_log.txt 2>&1
findstr /c:"[caballos] LISTO" ultimo_log.txt >nul
if errorlevel 1 (
  echo.
  echo Hubo un problema. Avisale a Claude: el detalle esta en arte\blender\ultimo_log.txt
) else (
  echo.
  echo Listo. Modelo: juego\public\modelos\caballo.glb  ^|  Vistas previas: arte\previews
)
pause
