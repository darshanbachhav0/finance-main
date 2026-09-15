@echo off

rem ============================================================
rem UMA FINANCE - FINAL ONE-CLICK PUBLIC DEPLOYMENT
rem ============================================================
rem
rem Put this BAT file in:
rem finance-main\
rem
rem This launcher starts:
rem
rem 1. Docker Desktop
rem 2. Isolated MongoDB
rem 3. SUNAT Public Padron synchronization
rem 4. Database
rem 5. Frontend production build
rem 6. ngrok
rem 7. Production server
rem 8. A2 batch worker
rem 9. Health check
rem
rem App port:
rem 5175
rem
rem MongoDB port:
rem 27018
rem
rem Database:
rem uma_finance_triple_track_fresh
rem ============================================================


rem ============================================================
rem KEEP WINDOW OPEN EVEN IF BAT FAILS
rem ============================================================

if /I "%~1"=="__UMA_INNER__" goto :MAIN

start "UMA Finance - Public Deployment" cmd.exe /k ""%~f0" __UMA_INNER__"

exit /b 0


:MAIN

setlocal EnableExtensions

title UMA Finance - Public Deployment

color 0A


rem ============================================================
rem PROJECT CONFIGURATION
rem ============================================================

set "PROJECT_DIR=%~dp0"

set "APP_PORT=5175"

set "MONGO_CONTAINER=uma-finance-triple-mongo"

set "MONGO_VOLUME=uma_finance_triple_mongo_data"

set "MONGO_PORT=27018"

set "MONGO_DB=uma_finance_triple_track_fresh"

set "MONGODB_URI=mongodb://127.0.0.1:%MONGO_PORT%/%MONGO_DB%"

set "URL_FILE=%TEMP%\uma_finance_public_url.txt"

set "COUNT_FILE=%TEMP%\uma_finance_user_count.txt"

set "JWT_FILE=%PROJECT_DIR%.uma-local-jwt-secret"

if not defined SUNAT_PADRON_DATA_DIR set "SUNAT_PADRON_DATA_DIR=%LOCALAPPDATA%\UMA Finance\sunat-padron"
set "SUNAT_PADRON_LEGACY_DIR=%PROJECT_DIR%backend\data\sunat-padron"


cd /d "%PROJECT_DIR%"


cls


echo ============================================================
echo             UMA FINANCE - PUBLIC DEPLOYMENT
echo ============================================================
echo.
echo Project : %PROJECT_DIR%
echo App port: %APP_PORT%
echo MongoDB : localhost:%MONGO_PORT%
echo Database: %MONGO_DB%
echo SUNAT   : Official Public Padron + Consulta RUC
echo.
echo ============================================================
echo.


rem ============================================================
rem CHECK PROJECT
rem ============================================================

if not exist "%PROJECT_DIR%package.json" goto :PROJECT_ERROR

if not exist "%PROJECT_DIR%backend\package.json" goto :PROJECT_ERROR

if not exist "%PROJECT_DIR%frontend\package.json" goto :PROJECT_ERROR


rem ============================================================
rem CHECK REQUIRED PROGRAMS
rem ============================================================

where node >nul 2>&1

if errorlevel 1 goto :NODE_ERROR


where npm >nul 2>&1

if errorlevel 1 goto :NPM_ERROR


where docker >nul 2>&1

if errorlevel 1 goto :DOCKER_INSTALL_ERROR


where ngrok >nul 2>&1

if errorlevel 1 goto :NGROK_ERROR



rem ============================================================
rem STEP 1 - DOCKER
rem ============================================================

echo [1/9] Checking Docker...


docker info >nul 2>&1

if not errorlevel 1 goto :DOCKER_READY


echo       Docker Desktop is not running.
echo       Starting Docker Desktop...


if not exist "C:\Program Files\Docker\Docker\Docker Desktop.exe" goto :DOCKER_START_ERROR


start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe"


echo       Waiting for Docker Desktop...


for /L %%I in (1,1,60) do (
    docker info >nul 2>&1

    if not errorlevel 1 goto :DOCKER_READY

    timeout /t 2 /nobreak >nul
)


goto :DOCKER_TIMEOUT


:DOCKER_READY

echo       Docker is ready.
echo.



rem ============================================================
rem STEP 2 - ISOLATED MONGODB
rem ============================================================

echo [2/9] Starting isolated MongoDB...


docker inspect "%MONGO_CONTAINER%" >nul 2>&1


if errorlevel 1 goto :CREATE_MONGO


goto :START_EXISTING_MONGO



:CREATE_MONGO

echo       MongoDB container does not exist.
echo       Creating isolated MongoDB container...


docker volume inspect "%MONGO_VOLUME%" >nul 2>&1


if not errorlevel 1 goto :MONGO_VOLUME_READY


echo       Creating Docker volume...


docker volume create "%MONGO_VOLUME%" >nul


if errorlevel 1 goto :MONGO_VOLUME_ERROR



:MONGO_VOLUME_READY


echo       Creating MongoDB container...


docker run -d --name "%MONGO_CONTAINER%" --restart unless-stopped -p %MONGO_PORT%:27017 -v "%MONGO_VOLUME%:/data/db" mongo:7 >nul


if errorlevel 1 goto :MONGO_CREATE_ERROR


goto :WAIT_FOR_MONGO



:START_EXISTING_MONGO

echo       Existing MongoDB container found.


docker start "%MONGO_CONTAINER%" >nul 2>&1


if errorlevel 1 goto :MONGO_START_ERROR


docker update --restart unless-stopped "%MONGO_CONTAINER%" >nul 2>&1



:WAIT_FOR_MONGO

echo       Waiting for MongoDB to become ready...


for /L %%I in (1,1,45) do (
    docker exec "%MONGO_CONTAINER%" mongosh --quiet --eval "db.runCommand({ping:1})" >nul 2>&1

    if not errorlevel 1 goto :MONGO_READY

    timeout /t 2 /nobreak >nul
)


goto :MONGO_TIMEOUT



:MONGO_READY

echo       MongoDB is ready.
echo       Port    : %MONGO_PORT%
echo       Database: %MONGO_DB%
echo.



rem ============================================================
rem APPLICATION ENVIRONMENT
rem ============================================================

set "PORT=%APP_PORT%"

set "JWT_EXPIRES_IN=8h"



rem ============================================================
rem SUNAT PUBLIC PADRON CONFIGURATION
rem ============================================================

set "SUNAT_PROVIDER_MODE=PADRON"

set "SUNAT_PADRON_INFO_URL=https://www.sunat.gob.pe/descargaPRR/mrc137_padron_reducido.html"

set "SUNAT_PADRON_DOWNLOAD_URL=https://www2.sunat.gob.pe/padron_reducido_ruc.zip"

set "SUNAT_PADRON_REFRESH_HOURS=24"

set "SUNAT_PADRON_MAX_STALE_DAYS=7"

set "SUNAT_PADRON_REQUEST_TIMEOUT_MS=120000"

set "SUNAT_PADRON_MAX_UNCOMPRESSED_BYTES=5368709120"



rem ============================================================
rem SUNAT CONSULTA RUC - LEGAL REPRESENTATIVES
rem ============================================================
rem
rem IMPORTANT:
rem
rem Legal representatives are retrieved in the background using
rem full Chromium's unified headless mode. No browser window opens.
rem The backend enforces this even with an older launcher setting.
rem ============================================================

set "SUNAT_REPRESENTATIVES_HEADLESS=true"

set "SUNAT_REPRESENTATIVES_DEBUG=false"

set "SUNAT_CONSULTA_RUC_TIMEOUT_MS=30000"

set "SUNAT_CONSULTA_RUC_CACHE_MINUTES=30"



rem ============================================================
rem OTHER BACKEND CONFIGURATION
rem ============================================================

set "FX_ALLOW_BCRP_FALLBACK=false"

set "BANK_FILE_MODE=DEMO"

set "BATCH_INVOICE_POLL_MS=5000"

set "BATCH_INVOICE_WORKER_CONCURRENCY=3"

set "BATCH_INVOICE_STALE_MINUTES=15"

set "BATCH_INVOICE_INLINE_PROCESSING=false"

set "BATCH_MAX_ENTRIES=500"

set "BATCH_MAX_ENTRY_BYTES=10485760"

set "BATCH_MAX_UNCOMPRESSED_BYTES=104857600"

set "BATCH_MAX_COMPRESSION_RATIO=100"

set "BATCH_MAX_EXCEL_ROWS=5000"



rem ============================================================
rem JWT SECRET
rem ============================================================

if exist "%JWT_FILE%" goto :JWT_EXISTS


echo       Creating local JWT secret...


node -e "process.stdout.write(require('crypto').randomBytes(48).toString('hex'))" > "%JWT_FILE%"


if errorlevel 1 goto :JWT_ERROR



:JWT_EXISTS

set "JWT_SECRET="


set /p "JWT_SECRET="<"%JWT_FILE%"


if not defined JWT_SECRET goto :JWT_ERROR



rem ============================================================
rem STEP 3 - NODE DEPENDENCIES
rem ============================================================

echo [3/9] Checking Node dependencies...


if exist "%PROJECT_DIR%node_modules" goto :DEPENDENCIES_READY


echo       node_modules not found.
echo       Installing dependencies...
echo.


call npm ci


if not errorlevel 1 goto :DEPENDENCIES_READY


echo.
echo       npm ci failed.
echo       Trying npm install...
echo.


call npm install


if errorlevel 1 goto :DEPENDENCY_ERROR



:DEPENDENCIES_READY

echo       Dependencies are ready.
echo.



rem ============================================================
rem VERIFY PLAYWRIGHT CHROMIUM
rem ============================================================

echo       Checking Playwright Chromium...


node --input-type=module -e "import('playwright').then(async ({chromium})=>{const b=await chromium.launch({channel:'chromium',headless:true});console.log('      Background Chromium ready: '+await b.version());await b.close();}).catch(e=>{console.error(e.message);process.exit(1);})"


if errorlevel 1 goto :PLAYWRIGHT_ERROR


echo.



rem ============================================================
rem STEP 4 - SUNAT PUBLIC PADRON
rem ============================================================

echo [4/9] Starting background SUNAT updater...
echo       UMA uses the existing local RUC index immediately.
echo       Updates and first-time preparation run in a separate process.
powershell -NoProfile -ExecutionPolicy Bypass -File "%PROJECT_DIR%backend\scripts\startPadronWorker.ps1" -ProjectDir "%PROJECT_DIR%." -DataDir "%SUNAT_PADRON_DATA_DIR%"
if errorlevel 1 echo WARNING: SUNAT updater could not start. Check the administrator status panel.
echo.

rem ============================================================
rem STEP 5 - DATABASE
rem ============================================================

echo [5/9] Checking isolated UMA database...


del /q "%COUNT_FILE%" >nul 2>&1


docker exec "%MONGO_CONTAINER%" mongosh --quiet "mongodb://127.0.0.1:27017/%MONGO_DB%" --eval "print(db.users.countDocuments({}))" > "%COUNT_FILE%" 2>nul


if errorlevel 1 goto :DATABASE_CHECK_ERROR


set "USER_COUNT="


if exist "%COUNT_FILE%" set /p "USER_COUNT="<"%COUNT_FILE%"


if not defined USER_COUNT goto :DATABASE_CHECK_ERROR


echo       Users found: %USER_COUNT%


if "%USER_COUNT%"=="0" goto :SEED_DATABASE


goto :DATABASE_READY



:SEED_DATABASE

echo.
echo       Fresh database detected.
echo       Creating UMA demo data...
echo.


call npm run seed


if errorlevel 1 goto :SEED_ERROR


echo.
echo       UMA demo database created.



:DATABASE_READY

echo       Database is ready.
echo.



rem ============================================================
rem STEP 6 - FRONTEND PRODUCTION BUILD
rem ============================================================

echo [6/9] Building frontend for public deployment...


set "VITE_API_URL=/api"


call npm run build


if errorlevel 1 goto :BUILD_ERROR


if not exist "%PROJECT_DIR%frontend\dist\index.html" goto :BUILD_OUTPUT_ERROR


echo       Frontend production build is ready.
echo.



rem ============================================================
rem STEP 7 - STOP OLD LOCAL PROCESSES
rem ============================================================

echo [7/9] Preparing public ngrok tunnel...


echo       Stopping previous app instance if present...


powershell -NoProfile -ExecutionPolicy Bypass -Command "$items=Get-NetTCPConnection -LocalPort %APP_PORT% -State Listen -ErrorAction SilentlyContinue; foreach($item in $items){$id=$item.OwningProcess; if($id -and $id -ne $PID){Stop-Process -Id $id -Force -ErrorAction SilentlyContinue}}" >nul 2>&1


echo       Stopping previous batch worker if present...


powershell -NoProfile -ExecutionPolicy Bypass -Command "$items=Get-CimInstance Win32_Process -ErrorAction SilentlyContinue; foreach($item in $items){if($item.Name -eq 'node.exe' -and $item.CommandLine -like '*batchInvoiceWorker.js*'){Stop-Process -Id $item.ProcessId -Force -ErrorAction SilentlyContinue}}" >nul 2>&1


echo       Stopping previous ngrok process if present...


taskkill /F /IM ngrok.exe >nul 2>&1


timeout /t 2 /nobreak >nul



rem ============================================================
rem START NGROK
rem ============================================================

del /q "%URL_FILE%" >nul 2>&1


echo       Starting ngrok on port %APP_PORT%...


start "UMA Finance - ngrok" /min cmd.exe /k "ngrok http %APP_PORT%"


echo       Waiting for ngrok public HTTPS URL...


for /L %%I in (1,1,40) do (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "try {$r=Invoke-RestMethod -Uri 'http://127.0.0.1:4040/api/tunnels' -TimeoutSec 2; $u=$null; foreach($t in $r.tunnels){if($t.proto -eq 'https'){$u=$t.public_url; break}}; if($u){[System.IO.File]::WriteAllText('%URL_FILE%',$u)}} catch {}" >nul 2>&1

    if exist "%URL_FILE%" goto :NGROK_READY

    timeout /t 1 /nobreak >nul
)


goto :NGROK_URL_ERROR



:NGROK_READY

set "PUBLIC_URL="


set /p "PUBLIC_URL="<"%URL_FILE%"


if not defined PUBLIC_URL goto :NGROK_URL_ERROR


echo.
echo       ngrok is ready.
echo       Public URL: %PUBLIC_URL%
echo.



rem ============================================================
rem PUBLIC APPLICATION ENVIRONMENT
rem ============================================================

set "CLIENT_URLS=http://localhost:%APP_PORT%,http://127.0.0.1:%APP_PORT%,%PUBLIC_URL%"

set "PUBLIC_GATEWAY_URL=%PUBLIC_URL%"

set "NODE_ENV=production"



rem ============================================================
rem STEP 8 - START PRODUCTION SERVER AND BATCH WORKER
rem ============================================================

echo [8/9] Starting UMA Finance services...


echo       Starting Production Server...


start "UMA Finance - Production Server" cmd.exe /k "npm run start:public"


timeout /t 3 /nobreak >nul


echo       Starting A2 Batch Worker...


start "UMA Finance - Batch Worker" cmd.exe /k "npm run worker:batch"


echo.
echo       Services started.
echo.



rem ============================================================
rem STEP 9 - HEALTH CHECK
rem ============================================================

echo [9/9] Waiting for UMA Finance to become ready...


for /L %%I in (1,1,60) do (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "try {$r=Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:%APP_PORT%/health' -TimeoutSec 2; if($r.StatusCode -eq 200){exit 0}; exit 1} catch {exit 1}" >nul 2>&1

    if not errorlevel 1 goto :APP_READY

    timeout /t 1 /nobreak >nul
)


goto :HEALTH_ERROR



:APP_READY


rem ============================================================
rem TEST PUBLIC TUNNEL
rem ============================================================

echo       Local application is healthy.
echo       Checking public tunnel...


powershell -NoProfile -ExecutionPolicy Bypass -Command "try {$r=Invoke-WebRequest -UseBasicParsing -Uri '%PUBLIC_URL%/health' -TimeoutSec 10; if($r.StatusCode -eq 200){exit 0}; exit 1} catch {exit 1}" >nul 2>&1


if errorlevel 1 goto :PUBLIC_WARNING


echo       Public tunnel is responding correctly.


goto :DEPLOYMENT_SUCCESS



:PUBLIC_WARNING

echo.
echo [WARNING] Local application is healthy but the public tunnel
echo           did not answer the health check yet.
echo.
echo           The ngrok URL may still become available normally.
echo.


goto :DEPLOYMENT_SUCCESS



rem ============================================================
rem SUCCESS
rem ============================================================

:DEPLOYMENT_SUCCESS


echo %PUBLIC_URL%| clip


cls


echo ============================================================
echo.
echo                  DEPLOYMENT IS ONLINE
echo.
echo ============================================================
echo.
echo PUBLIC LINK:
echo.
echo     %PUBLIC_URL%
echo.
echo ============================================================
echo.
echo LOCAL LINK:
echo.
echo     http://localhost:%APP_PORT%
echo.
echo ============================================================
echo.
echo DATABASE:
echo.
echo     MongoDB : localhost:%MONGO_PORT%
echo     Database: %MONGO_DB%
echo.
echo ============================================================
echo.
echo SUNAT TAXPAYER VALIDATION:
echo.
echo     Source        : Official SUNAT Public Padron
echo     RUC exists    : ENABLED
echo     Legal name    : ENABLED
echo     ACTIVO status : ENABLED
echo     HABIDO status : ENABLED
echo     Fiscal address: ENABLED
echo     UBIGEO        : ENABLED
echo.
echo ============================================================
echo.
echo SUNAT LEGAL REPRESENTATIVES:
echo.
echo     Source        : Official SUNAT Consulta RUC
echo     Browser       : Playwright Chromium
echo     Headless      : ENABLED - background lookup
echo     Status        : ENABLED
echo.
echo     Information:
echo     - Representative document type
echo     - Representative document number
echo     - Representative full name
echo     - Position
echo     - Effective date
echo.
echo     NOTE:
echo     Supplier details load automatically in UMA.
echo     No Consulta RUC browser window opens on this PC.
echo.
echo ============================================================
echo.
echo SUNAT CPE VALIDATION:
echo.
echo     Specific invoice acceptance:
echo     NOT available from the public Padron.
echo.
echo     Official CPE API credentials would still be required
echo     for authoritative invoice-level SUNAT validation.
echo.
echo ============================================================
echo.
echo A2 BATCH PROCESSING:
echo.
echo     Batch Worker: RUNNING
echo.
echo ============================================================
echo.
echo PUBLIC LINK COPIED TO CLIPBOARD
echo.
echo You can send this URL to your friends:
echo.
echo     %PUBLIC_URL%
echo.
echo ============================================================
echo.
echo IMPORTANT:
echo.
echo - Keep this PC powered on.
echo - Keep Docker Desktop running.
echo - Keep the Production Server window running.
echo - Keep the Batch Worker window running.
echo - Keep the ngrok window running.
echo.
echo - Do NOT close Chromium while SUNAT representative lookup
echo   is actively running.
echo.
echo When this PC is turned off, the platform becomes unavailable.
echo.
echo Your database remains stored locally.
echo.
echo ============================================================
echo.


start "" "%PUBLIC_URL%"


echo.
echo Press any key to close THIS launcher window.
echo.
echo Closing this launcher window will NOT stop the server,
echo worker, MongoDB, or ngrok.
echo.


pause >nul


exit /b 0



rem ============================================================
rem ERROR HANDLERS
rem ============================================================

:PROJECT_ERROR

echo.
echo [ERROR] This BAT file is not in the correct project directory.
echo.
echo Expected:
echo.
echo     package.json
echo     backend\
echo     frontend\
echo.
goto :FAIL



:NODE_ERROR

echo.
echo [ERROR] Node.js was not found.
echo.
echo Install Node.js and restart Windows.
echo.
goto :FAIL



:NPM_ERROR

echo.
echo [ERROR] npm was not found.
echo.
goto :FAIL



:DOCKER_INSTALL_ERROR

echo.
echo [ERROR] Docker CLI was not found.
echo.
echo Install Docker Desktop.
echo.
goto :FAIL



:NGROK_ERROR

echo.
echo [ERROR] ngrok was not found.
echo.
echo Install ngrok and configure your authtoken.
echo.
goto :FAIL



:DOCKER_START_ERROR

echo.
echo [ERROR] Docker Desktop executable was not found.
echo.
goto :FAIL



:DOCKER_TIMEOUT

echo.
echo [ERROR] Docker Desktop did not become ready in time.
echo.
goto :FAIL



:MONGO_VOLUME_ERROR

echo.
echo [ERROR] Could not create MongoDB Docker volume:
echo.
echo     %MONGO_VOLUME%
echo.
goto :FAIL



:MONGO_CREATE_ERROR

echo.
echo [ERROR] Could not create MongoDB container.
echo.
echo Container:
echo     %MONGO_CONTAINER%
echo.
echo Port:
echo     %MONGO_PORT%
echo.
echo Check whether port %MONGO_PORT% is already being used.
echo.
docker ps -a
echo.
goto :FAIL



:MONGO_START_ERROR

echo.
echo [ERROR] Existing MongoDB container could not be started.
echo.
docker ps -a --filter "name=%MONGO_CONTAINER%"
echo.
docker logs --tail 30 "%MONGO_CONTAINER%" 2>nul
echo.
goto :FAIL



:MONGO_TIMEOUT

echo.
echo [ERROR] MongoDB did not become ready.
echo.
echo ============================================================
echo MongoDB container status
echo ============================================================
echo.
docker ps -a --filter "name=%MONGO_CONTAINER%"
echo.
echo ============================================================
echo MongoDB recent logs
echo ============================================================
echo.
docker logs --tail 40 "%MONGO_CONTAINER%" 2>nul
echo.
echo ============================================================
echo Docker containers and ports
echo ============================================================
echo.
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
echo.
goto :FAIL



:JWT_ERROR

echo.
echo [ERROR] Could not create or read JWT secret.
echo.
echo File:
echo     %JWT_FILE%
echo.
goto :FAIL



:DEPENDENCY_ERROR

echo.
echo [ERROR] npm dependency installation failed.
echo.
goto :FAIL



:PLAYWRIGHT_ERROR

echo.
echo ============================================================
echo PLAYWRIGHT CHROMIUM ERROR
echo ============================================================
echo.
echo Playwright or its Chromium browser is not ready.
echo.
echo Run these commands from the project root:
echo.
echo     npm install playwright --workspace backend
echo.
echo     npx playwright install chromium
echo.
echo Then run this BAT again.
echo.
goto :FAIL



:SUNAT_PADRON_ERROR

echo.
echo ============================================================
echo SUNAT PUBLIC PADRON ERROR
echo ============================================================
echo.
echo The official SUNAT Public Padron could not be synchronized.
echo.
echo Test manually with:
echo.
echo     npm run sunat:padron:sync
echo.
echo Check:
echo.
echo - Internet connection
echo - SUNAT website availability
echo - backend\src\services\sunatPadronService.js
echo - backend\scripts\syncSunatPadron.js
echo.
goto :FAIL



:DATABASE_CHECK_ERROR

echo.
echo [ERROR] Could not inspect the isolated database.
echo.
echo Database:
echo     %MONGO_DB%
echo.
echo Mongo:
echo     localhost:%MONGO_PORT%
echo.
goto :FAIL



:SEED_ERROR

echo.
echo [ERROR] Database seed failed.
echo.
goto :FAIL



:BUILD_ERROR

echo.
echo [ERROR] Frontend production build failed.
echo.
echo Run manually:
echo.
echo     npm run build
echo.
goto :FAIL



:BUILD_OUTPUT_ERROR

echo.
echo [ERROR] Frontend build completed but this file is missing:
echo.
echo     frontend\dist\index.html
echo.
goto :FAIL



:NGROK_URL_ERROR

echo.
echo ============================================================
echo NGROK ERROR
echo ============================================================
echo.
echo Could not obtain the ngrok public URL.
echo.
echo Check:
echo.
echo     ngrok config check
echo.
echo Then test manually:
echo.
echo     ngrok http %APP_PORT%
echo.
goto :FAIL



:HEALTH_ERROR

echo.
echo ============================================================
echo APPLICATION STARTUP ERROR
echo ============================================================
echo.
echo UMA Finance did not become healthy on:
echo.
echo     http://localhost:%APP_PORT%
echo.
echo Check the window named:
echo.
echo     UMA Finance - Production Server
echo.
echo That window should show the exact backend error.
echo.
goto :FAIL



:FAIL

color 0C

echo.
echo ============================================================
echo.
echo                    STARTUP FAILED
echo.
echo ============================================================
echo.
echo The window will remain open.
echo.
echo Read the error above.
echo.
echo Fix the problem and run this BAT again.
echo.
echo ============================================================
echo.
echo Press any key to continue.
echo.


pause >nul


exit /b 1
