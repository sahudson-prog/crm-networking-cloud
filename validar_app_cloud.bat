@echo off
setlocal
cd /d "%~dp0cloud\web"

echo Validando CRM Networking Cloud...
echo.

call npm run typecheck
if errorlevel 1 goto error

call npm run build
if errorlevel 1 goto error

cd /d "%~dp0"
if exist "cloud\web\tsconfig.tsbuildinfo" del "cloud\web\tsconfig.tsbuildinfo"

echo.
echo Validacion completada correctamente.
pause
exit /b 0

:error
echo.
echo La validacion encontro un problema. Revisa el mensaje anterior.
pause
exit /b 1
