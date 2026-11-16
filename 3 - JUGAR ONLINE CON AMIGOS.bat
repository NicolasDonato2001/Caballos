@echo off
title Caballos - Jugar online con amigos
cd /d "%~dp0"
echo ============================================================
echo   CABALLOS - JUGAR ONLINE CON AMIGOS
echo   Cada uno desde su casa, con su propio internet.
echo ============================================================
echo.
where node >nul 2>nul || goto sinnode
:empezar
rem Tiene que haber un solo servidor: el de este archivo
netstat -ano | findstr /R /C:":8787 .*LISTENING" /C:":8787 .*ESCUCHANDO" >nul && goto ocupado

rem 1) cloudflared: el programa gratis de Cloudflare que crea el tunel. Sirve con cualquiera de los dos nombres.
set "CF=%~dp0herramientas\cloudflared.exe"
if not exist "%CF%" if exist "%~dp0herramientas\cloudflared-windows-amd64.exe" set "CF=%~dp0herramientas\cloudflared-windows-amd64.exe"
if exist "%CF%" goto armar
echo Bajando cloudflared de la pagina oficial de Cloudflare en GitHub, una sola vez...
if not exist "%~dp0herramientas" mkdir "%~dp0herramientas"
curl -L -o "%~dp0herramientas\cloudflared.exe" https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe
if errorlevel 1 goto sincf
set "CF=%~dp0herramientas\cloudflared.exe"

:armar
rem 2) Armar el juego: la version empaquetada, liviana para mandar por internet
cd /d "%~dp0juego"
if not exist node_modules call npm install
echo Armando el juego para internet, tarda un poquito...
call npm run armar
if errorlevel 1 goto error

rem 3) El servidor entrega el juego y las carreras online, todo en una sola direccion
start "Caballos - Servidor (no cerrar)" /min cmd /k "cd /d "%~dp0juego" && npm run publico"
echo Esperando que arranque el servidor...
timeout /t 4 /nobreak >nul
start "" http://127.0.0.1:8787
echo.
rem 4) El tunel: muestra la direccion para tus amigos y la copia al portapapeles
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0herramientas\tunel.ps1" -Cf "%CF%"
echo.
echo El tunel se cerro.
pause
goto fin

:ocupado
echo Ya hay un servidor del juego prendido: es la ventana "Caballos - Servidor",
echo que puede estar minimizada en la barra de tareas.
echo Para jugar online con tus amigos hay que cerrarla y abrirla de nuevo con lo ultimo.
echo.
set "CERRAR="
set /p "CERRAR=Lo cierro yo? s/n - Enter = s: "
if /i "%CERRAR%"=="n" goto fin
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /R /C:":8787 .*LISTENING" /C:":8787 .*ESCUCHANDO"') do taskkill /PID %%p /T /F >nul 2>nul
timeout /t 2 /nobreak >nul
netstat -ano | findstr /R /C:":8787 .*LISTENING" /C:":8787 .*ESCUCHANDO" >nul && goto nocerro
echo Listo, se cerro el servidor anterior. Sigo...
echo.
goto empezar

:nocerro
echo No se pudo cerrar solo. Cerra a mano la ventana "Caballos - Servidor" y volve a abrir este archivo.
pause
goto fin

:sincf
echo No se pudo bajar cloudflared. Bajalo a mano desde
echo https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe
echo y ponelo en la carpeta Caballos\herramientas
pause
goto fin

:sinnode
echo Falta Node.js. Bajalo de https://nodejs.org (version LTS), instalalo y volve a abrir este archivo.
pause
goto fin

:error
echo No se pudo armar el juego. Sacale una foto a esta ventana y pasasela a Claude.
pause

:fin
