@echo off
title Caballos - Juego
cd /d "%~dp0juego"
echo ============================================================
echo   CABALLOS - ABRIR EL JUEGO
echo   Abre el servidor y el juego. Para jugar solo o con cuenta.
echo ============================================================
echo.
where node >nul 2>nul || goto sinnode
if not exist node_modules goto instalar
:listo
rem Si el juego ya esta abierto, solo se abre el navegador
netstat -ano | findstr /R /C:":5173 .*LISTENING" /C:":5173 .*ESCUCHANDO" >nul && goto yaabierto
rem El servidor, en su ventana (si no estaba prendido)
netstat -ano | findstr /R /C:":8787 .*LISTENING" /C:":8787 .*ESCUCHANDO" >nul || start "Caballos - Servidor (no cerrar)" /min cmd /k "cd /d "%~dp0juego" && npm run servidor"
echo El juego se abre en el navegador: http://localhost:5173
echo No cierres esta ventana mientras juegas. Para cerrar: Ctrl + C.
echo.
call npm run dev -- --open
goto fin

:yaabierto
echo El juego ya estaba abierto: lo abro en el navegador.
start "" http://localhost:5173
timeout /t 3 /nobreak >nul
goto fin

:instalar
echo Instalando lo que necesita el juego, una sola vez...
call npm install
if errorlevel 1 goto error
goto listo

:sinnode
echo Falta Node.js. Bajalo de https://nodejs.org (version LTS), instalalo y volve a abrir este archivo.
pause
goto fin

:error
echo Algo salio mal. Sacale una foto a esta ventana y pasasela a Claude.
pause

:fin
