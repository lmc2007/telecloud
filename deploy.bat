@echo off
setlocal enabledelayedexpansion

echo ============================================
echo  Cloud Nine Deploy
echo ============================================
echo.

if not "%CLOUDFLARE_API_TOKEN%"=="" goto :have_token

if not exist ".env" goto :no_env

for /f "usebackq tokens=1,* delims==" %%a in (".env") do (
    if "%%a"=="CLOUDFLARE_API_TOKEN" set "CF_TOKEN=%%b"
)

if defined CF_TOKEN (
    set "CLOUDFLARE_API_TOKEN=!CF_TOKEN!"
    goto :have_token
)

:no_env
echo [ERROR] CLOUDFLARE_API_TOKEN not found
echo Please create .env in project root with:
echo   CLOUDFLARE_API_TOKEN=your-token-here
pause
exit /b 1

:have_token
echo [1/4] Building Worker...
cd worker
call npm run build
if %ERRORLEVEL% neq 0 (
    echo [FAIL] Worker build failed!
    cd ..
    pause
    exit /b 1
)
echo [OK] Worker build done

echo.
echo [2/4] Deploying Worker (tgdrive)...
call npm run deploy
if %ERRORLEVEL% neq 0 (
    echo [FAIL] Worker deploy failed!
    cd ..
    pause
    exit /b 1
)
echo [OK] Worker deployed
cd ..

echo.
echo [3/4] Building Frontend...
cd frontend
call npm run build
if %ERRORLEVEL% neq 0 (
    echo [FAIL] Frontend build failed!
    cd ..
    pause
    exit /b 1
)
echo [OK] Frontend build done

echo.
echo [4/4] Deploying Frontend (muleng-frontend)...
call npm run deploy
if %ERRORLEVEL% neq 0 (
    echo [FAIL] Frontend deploy failed!
    cd ..
    pause
    exit /b 1
)
echo [OK] Frontend deployed
cd ..

echo.
echo ============================================
echo  Deploy complete!
echo  Frontend: https://pan.muleng.dpdns.org
echo  API:      https://pan.muleng.dpdns.org/api
echo ============================================
pause
