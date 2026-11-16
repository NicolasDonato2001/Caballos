@echo off
title Caballos - Dar caballos de linaje raro (pruebas)
cd /d "%~dp0juego"
echo ============================================================
echo   CABALLOS - DAR CABALLOS DE LINAJE RARO  (herramienta de pruebas)
echo   Nacen como en la crianza del juego, ya adultos.
echo   Funciona con el servidor prendido o apagado.
echo ============================================================
where node >nul 2>nul || goto sinnode

:otro
echo.
set "NOMBRE="
set /p "NOMBRE=Usuario, por ejemplo NICO o LUCIANO: "
if "%NOMBRE%"=="" goto fin
echo.
echo   1 = Dorado del Desierto  - Arabe x Akhal-Teke
echo   2 = Barroco Azabache     - Andaluz x Frison
echo   3 = Relampago            - Pura Sangre x Cuarto de Milla
echo   4 = Overo de la Pampa    - Criollo x Appaloosa
echo   5 = Los cuatro
set "OPC="
set /p "OPC=Cual linaje? 1 a 5 - Enter = 5: "
set "LIN=todos"
if "%OPC%"=="1" set "LIN=dorado"
if "%OPC%"=="2" set "LIN=barroco"
if "%OPC%"=="3" set "LIN=relampago"
if "%OPC%"=="4" set "LIN=pampa"
set "SX="
set /p "SX=Sexo? m = macho, h = hembra, a = uno de cada - Enter = a: "
set "SEXO=ambos"
if /i "%SX%"=="m" set "SEXO=macho"
if /i "%SX%"=="h" set "SEXO=hembra"
echo.
node --no-warnings tools/linajes.ts "%NOMBRE%" %LIN% %SEXO%
echo.
set "SEGUIR="
set /p "SEGUIR=Otro usuario? s/n: "
if /i "%SEGUIR%"=="s" goto otro
goto fin

:sinnode
echo Falta Node.js. Bajalo de https://nodejs.org (version LTS), instalalo y volve a abrir este archivo.

:fin
echo.
echo Para verlos en el juego, recarga la pagina (F5).
pause
