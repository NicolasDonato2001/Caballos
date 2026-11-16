@echo off
title Caballos - Juego
cd /d "%~dp0juego"
echo Abriendo el juego... (no cierres esta ventana mientras jugas)
echo Para cerrarlo: Ctrl + C
echo.
rem Abre el navegador unos segundos despues, cuando el juego ya esta listo
start "" cmd /c "timeout /t 4 /nobreak >nul & start http://localhost:5173"
call npm run dev
echo.
echo El juego se cerro.
pause
