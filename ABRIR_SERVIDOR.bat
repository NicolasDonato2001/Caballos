@echo off
title Caballos - Servidor
cd /d "%~dp0juego"
echo Abriendo el servidor del juego (cuentas, partidas y carreras online)...
echo No cierres esta ventana mientras juegues online. Para cerrarlo: Ctrl + C
echo.
call npm run servidor
echo.
echo El servidor se cerro.
pause
