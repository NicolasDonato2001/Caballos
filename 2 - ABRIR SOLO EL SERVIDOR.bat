@echo off
title Caballos - Servidor (no cerrar)
cd /d "%~dp0juego"
echo ============================================================
echo   CABALLOS - SERVIDOR DEL JUEGO
echo   Guarda las cuentas y las partidas y corre las carreras online.
echo   El juego en si se abre con "1 - ABRIR EL JUEGO".
echo ============================================================
echo.
where node >nul 2>nul || goto sinnode
netstat -ano | findstr /R /C:":8787 .*LISTENING" /C:":8787 .*ESCUCHANDO" >nul && goto yaprendido
if not exist node_modules call npm install
echo No cierres esta ventana mientras juegas. Para apagarlo: Ctrl + C.
echo.
call npm run servidor
pause
goto fin

:yaprendido
echo El servidor ya esta prendido en otra ventana. No hace falta abrirlo de nuevo.
pause
goto fin

:sinnode
echo Falta Node.js. Bajalo de https://nodejs.org (version LTS), instalalo y volve a abrir este archivo.
pause

:fin
