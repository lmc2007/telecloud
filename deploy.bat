@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo ============================================
echo  Cloud Nine 一键部署
echo ============================================
echo.

if "%CLOUDFLARE_API_TOKEN%"=="" (
    if exist .env (
        for /f "tokens=1,2 delims==" %%a in (.env) do (
            if "%%a"=="CLOUDFLARE_API_TOKEN" set CLOUDFLARE_API_TOKEN=%%b
        )
    )
)

if "%CLOUDFLARE_API_TOKEN%"=="" (
    echo [错误] 未找到 CLOUDFLARE_API_TOKEN
    echo 请在项目根目录 .env 文件中设置:
    echo   CLOUDFLARE_API_TOKEN=your-token-here
    exit /b 1
)

echo [1/4] 构建后端 Worker...
cd worker
call npm run build
if %ERRORLEVEL% neq 0 (
    echo [失败] Worker 构建出错！
    exit /b 1
)
echo [完成] Worker 构建成功

echo.
echo [2/4] 部署后端 Worker (tgdrive)...
call npm run deploy
if %ERRORLEVEL% neq 0 (
    echo [失败] Worker 部署出错！
    exit /b 1
)
echo [完成] Worker 部署成功

echo.
echo [3/4] 构建前端...
cd ..\frontend
call npm run build
if %ERRORLEVEL% neq 0 (
    echo [失败] 前端构建出错！
    exit /b 1
)
echo [完成] 前端构建成功

echo.
echo [4/4] 部署前端 (muleng-frontend)...
call npm run deploy
if %ERRORLEVEL% neq 0 (
    echo [失败] 前端部署出错！
    exit /b 1
)
echo [完成] 前端部署成功

echo.
echo ============================================
echo  全部部署完成！
echo  前端: https://pan.muleng.dpdns.org
echo  后端: https://pan.muleng.dpdns.org/api
echo ============================================
cd ..
pause
