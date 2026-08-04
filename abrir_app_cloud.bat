@echo off
setlocal

set "SOURCE_DIR=%~dp0cloud\web"
set "RUN_DIR=%LOCALAPPDATA%\CRMNetworking\cloud-web-run"

echo Iniciando CRM Networking Cloud...
echo.
echo Preparando una copia local estable fuera de OneDrive...
echo.

if not exist "%RUN_DIR%" mkdir "%RUN_DIR%"
if exist "%RUN_DIR%\.next" rmdir /s /q "%RUN_DIR%\.next"

robocopy "%SOURCE_DIR%" "%RUN_DIR%" /E /XD .next /NFL /NDL /NJH /NJS /NP
if errorlevel 8 goto error

cd /d "%RUN_DIR%"

echo Cuando veas "Ready", abre:
echo http://localhost:3000
echo.
echo Para detener la app, cierra esta ventana o presiona Ctrl+C.
echo.

npm run dev -- --port 3000

echo.
echo La app se detuvo.
pause
exit /b 0

:error
echo.
echo No se pudo preparar la app. Revisa el mensaje anterior.
pause
exit /b 1
