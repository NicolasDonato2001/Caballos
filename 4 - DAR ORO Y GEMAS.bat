@echo off
title Caballos - Dar Oro y Gemas (pruebas)
cd /d "%~dp0juego"
echo ============================================================
echo   CABALLOS - DAR ORO Y GEMAS  (herramienta de pruebas)
echo   Deja a un usuario con el Oro y las Gemas que escribas.
echo   Funciona con el servidor prendido o apagado.
echo ============================================================
where node >nul 2>nul || goto sinnode

:otro
echo.
set "NOMBRE="
set "ORO="
set "GEMAS="
set /p "NOMBRE=Usuario, por ejemplo NICO o LUCIANO: "
if "%NOMBRE%"=="" goto fin
set /p "ORO=Oro que va a tener, sin puntos - Enter = 100000: "
if "%ORO%"=="" set "ORO=100000"
set /p "GEMAS=Gemas que va a tener - Enter = 1000: "
if "%GEMAS%"=="" set "GEMAS=1000"
node --no-warnings tools/monedas.ts "%NOMBRE%" %ORO% %GEMAS%
echo.
set "SEGUIR="
set /p "SEGUIR=Otro usuario? s/n: "
if /i "%SEGUIR%"=="s" goto otro
goto fin

:sinnode
echo Falta Node.js. Bajalo de https://nodejs.org (version LTS), instalalo y volve a abrir este archivo.

:fin
echo.
echo Para verlo en el juego, recarga la pagina (F5).
pause
