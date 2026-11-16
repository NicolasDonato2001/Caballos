@echo off
title Caballos - Jugar con amigos por internet
cd /d "%~dp0"
echo ============================================================
echo   CABALLOS - JUGAR CON AMIGOS POR INTERNET
echo   (cada uno en su casa, con su propio Wi-Fi)
echo ============================================================
echo.
rem 1) cloudflared: el programa gratis de Cloudflare que crea el tunel.
rem    Sirve con cualquiera de los dos nombres (el bajado a mano se llama cloudflared-windows-amd64.exe).
set "CF=%~dp0herramientas\cloudflared.exe"
if not exist "%CF%" if exist "%~dp0herramientas\cloudflared-windows-amd64.exe" set "CF=%~dp0herramientas\cloudflared-windows-amd64.exe"
if not exist "%CF%" (
  echo Bajando cloudflared de la pagina oficial de Cloudflare en GitHub, una sola vez...
  if not exist "%~dp0herramientas" mkdir "%~dp0herramientas"
  curl -L -o "%~dp0herramientas\cloudflared.exe" https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe
  if errorlevel 1 (
    echo No se pudo bajar cloudflared. Bajalo a mano desde
    echo https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe
    echo y ponelo en la carpeta Caballos\herramientas
    pause
    exit /b 1
  )
  set "CF=%~dp0herramientas\cloudflared.exe"
)

rem 2) Armar el juego (la version empaquetada, liviana para mandar por internet)
cd /d "%~dp0juego"
if not exist node_modules (
  echo Instalando lo que necesita el juego, una sola vez...
  call npm install
)
echo Armando el juego para internet (tarda un poquito)...
call npm run armar
if errorlevel 1 (
  echo.
  echo No se pudo armar el juego. Sacale una foto a esta ventana y pasasela a Claude.
  pause
  exit /b 1
)

rem 3) El servidor entrega el juego y las carreras online, todo en una sola direccion
start "Caballos - Servidor (no cerrar)" cmd /k "cd /d "%~dp0juego" && npm run publico"
echo Esperando que arranque el servidor...
timeout /t 4 /nobreak >nul
start "" http://127.0.0.1:8787
echo.
echo ============================================================
echo  En unos segundos abajo aparece un recuadro con una direccion
echo  que termina en  .trycloudflare.com
echo.
echo  PASALES ESA DIRECCION A TUS AMIGOS (por WhatsApp, Discord...).
echo  Vos jugas en  http://127.0.0.1:8787   (ya se abrio)
echo.
echo  Si a tus amigos les da error apenas aparece la direccion,
echo  que esperen medio minuto y recarguen la pagina.
echo.
echo  La direccion cambia cada vez que abris este archivo.
echo  Cualquiera que tenga la direccion puede entrar: pasala solo
echo  a tus amigos y cerra todo cuando terminen.
echo  Para cerrar: Ctrl + C aca y en la ventana del servidor.
echo ============================================================
echo.
"%CF%" tunnel --url http://127.0.0.1:8787
echo.
echo El tunel se cerro.
pause
