@echo off
title Caballos - Jugar con amigos (misma red Wi-Fi)
cd /d "%~dp0juego"
echo ============================================================
echo   CABALLOS - JUGAR CON AMIGOS EN LA MISMA RED
echo ============================================================
echo.
echo 1) Se abre el servidor en otra ventana (no la cierres).
start "Caballos - Servidor" cmd /k "cd /d "%~dp0juego" && npm run servidor"
echo.
echo 2) Tus amigos tienen que abrir en SU navegador una de estas direcciones
echo    (la que empiece con 192.168 o 10.):
echo.
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do for /f "tokens=1" %%b in ("%%a") do echo        http://%%b:5173
echo.
echo    Vos podes jugar desde esta compu en: http://localhost:5173
echo.
echo Si Windows pregunta si Node puede usar la red, elegi "Redes privadas".
echo Para cerrar todo: Ctrl + C en esta ventana y en la del servidor.
echo ============================================================
echo.
start "" cmd /c "timeout /t 5 /nobreak >nul & start http://localhost:5173"
call npm run red
echo.
echo El juego se cerro.
pause
