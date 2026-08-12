@echo off
setlocal enabledelayedexpansion

echo ============================================
echo  Cloud Nine Deploy
echo ============================================
echo.

:: Defaults
set "WORKER_NAME=tgdrive"
set "PAGES_NAME=tgdrive-pages"
set "DOMAIN="

:: Load .env
if exist ".env" (
    for /f "usebackq tokens=1,* delims==" %%a in (".env") do (
        if "%%a"=="CLOUDFLARE_API_TOKEN" set "CLOUDFLARE_API_TOKEN=%%b"
        if "%%a"=="WORKER_NAME" if not "%%b"=="" set "WORKER_NAME=%%b"
        if "%%a"=="PAGES_NAME" if not "%%b"=="" set "PAGES_NAME=%%b"
        if "%%a"=="DOMAIN" if not "%%b"=="" set "DOMAIN=%%b"
    )
)

if "%CLOUDFLARE_API_TOKEN%"=="" (
    echo [ERROR] CLOUDFLARE_API_TOKEN not found
    echo Please create .env in project root with:
    echo   CLOUDFLARE_API_TOKEN=your-token-here
    pause
    exit /b 1
)

echo [Config] Worker: %WORKER_NAME%  Pages: %PAGES_NAME%
if not "%DOMAIN%"=="" echo [Config] Domain: %DOMAIN%
echo.

echo [1/5] Building Worker...
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
echo [2/5] Deploying Worker (%WORKER_NAME%)...
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
echo [3/5] Building Frontend...
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
echo [4/5] Ensuring Pages project exists (%PAGES_NAME%)...
call npx wrangler pages project create %PAGES_NAME% --production-branch=main 2>nul
echo [OK] Pages project ready

echo.
echo [5/5] Deploying Frontend (%PAGES_NAME%)...
call npx wrangler pages deploy dist --project-name=%PAGES_NAME%
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
if "%DOMAIN%"=="" (
    echo  Frontend: https://%PAGES_NAME%.pages.dev
    echo  API:      https://%WORKER_NAME%.workers.dev/api
) else (
    echo  Frontend: https://%DOMAIN%
    echo  API:      https://%DOMAIN%/api
)
echo ============================================
pause
