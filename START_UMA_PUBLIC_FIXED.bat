@echo off

rem ============================================================
rem UMA FINANCE - DEMO-ONLY PUBLIC LAUNCHER (ngrok)
rem ============================================================
rem
rem DEMO ONLY. This is NOT the production deployment.
rem Production runs on Render (render.yaml, docs/OPERATIONS.md).
rem This launcher exposes a laptop-hosted copy with demo data
rem through a temporary ngrok link for presentations only.
rem Never load real university data into it.
rem
rem Put this BAT file in:
rem finance-main\
rem
rem This launcher starts:
rem
rem 1. Docker Desktop
rem 2. Isolated MongoDB (127.0.0.1 only, authentication on)
rem 3. SUNAT Public Padron synchronization
rem 4. Database
rem 5. Frontend production build
rem 6. ngrok
rem 7. Server (runs the A2 batch worker and the SLA
rem    escalation worker in-process)
rem 8. Health check
rem
rem App port:
rem 5175
rem
rem MongoDB port:
rem 127.0.0.1:27018 (never published on the network)
rem
rem MongoDB credentials:
rem user uma_demo_admin, password generated on first run and
rem stored only in .uma-local-mongo-password (not committed)
rem
rem Database:
rem uma_finance_triple_track_fresh
rem ============================================================


rem ============================================================
rem KEEP WINDOW OPEN EVEN IF BAT FAILS
rem ============================================================

if /I "%~1"=="__UMA_INNER__" goto :MAIN

start "UMA Finance - DEMO Public Launcher" cmd.exe /k ""%~f0" __UMA_INNER__"

exit /b 0


:MAIN

setlocal EnableExtensions

title UMA Finance - DEMO Public Launcher

color 0A


rem ============================================================
rem PROJECT CONFIGURATION
rem ============================================================

set "PROJECT_DIR=%~dp0"

set "APP_PORT=5175"

rem Secured container (127.0.0.1 binding + auth). The previous,
rem unauthenticated container name is migrated automatically.
set "MONGO_CONTAINER=uma-finance-triple-mongo-auth"

set "LEGACY_MONGO_CONTAINER=uma-finance-triple-mongo"

set "MONGO_VOLUME=uma_finance_triple_mongo_data"

set "MONGO_PORT=27018"

set "MONGO_DB=uma_finance_triple_track_fresh"

set "MONGO_USER=uma_demo_admin"

set "MONGO_PASSWORD_FILE=%PROJECT_DIR%.uma-local-mongo-password"

set "URL_FILE=%TEMP%\uma_finance_public_url.txt"

set "COUNT_FILE=%TEMP%\uma_finance_user_count.txt"

set "JWT_FILE=%PROJECT_DIR%.uma-local-jwt-secret"

if not defined SUNAT_PADRON_DATA_DIR set "SUNAT_PADRON_DATA_DIR=%LOCALAPPDATA%\UMA Finance\sunat-padron"
set "SUNAT_PADRON_LEGACY_DIR=%PROJECT_DIR%backend\data\sunat-padron"


cd /d "%PROJECT_DIR%"


cls


echo ============================================================
echo        UMA FINANCE - DEMO-ONLY PUBLIC LAUNCHER
echo ============================================================
echo.
echo  DEMO ONLY - production runs on Render, not on this PC.
echo  Use demo data only. The ngrok link is temporary.
echo.
echo Project : %PROJECT_DIR%
echo App port: %APP_PORT%
echo MongoDB : 127.0.0.1:%MONGO_PORT% (authentication on)
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
rem MONGODB PASSWORD (generated locally, never committed)
rem ============================================================

set "MONGO_PASSWORD_CREATED="

if exist "%MONGO_PASSWORD_FILE%" goto :MONGO_PASSWORD_EXISTS


echo       Creating local MongoDB password...


node -e "process.stdout.write(require('crypto').randomBytes(24).toString('hex'))" > "%MONGO_PASSWORD_FILE%"


if errorlevel 1 goto :MONGO_PASSWORD_ERROR


set "MONGO_PASSWORD_CREATED=1"



:MONGO_PASSWORD_EXISTS

set "MONGO_PASSWORD="


set /p "MONGO_PASSWORD="<"%MONGO_PASSWORD_FILE%"


if not defined MONGO_PASSWORD goto :MONGO_PASSWORD_ERROR


set "MONGO_SHELL_AUTH=-u %MONGO_USER% -p %MONGO_PASSWORD% --authenticationDatabase admin"

set "MONGODB_URI=mongodb://%MONGO_USER%:%MONGO_PASSWORD%@127.0.0.1:%MONGO_PORT%/%MONGO_DB%?authSource=admin"



rem ============================================================
rem STEP 2 - ISOLATED MONGODB
rem ============================================================

echo [2/9] Starting isolated MongoDB (127.0.0.1 only, auth on)...


docker inspect "%MONGO_CONTAINER%" >nul 2>&1


if errorlevel 1 goto :CHECK_LEGACY_MONGO


rem A secured container whose password file was deleted cannot be
rem opened with a newly generated password.
if defined MONGO_PASSWORD_CREATED goto :MONGO_PASSWORD_LOST


goto :START_EXISTING_MONGO



:CHECK_LEGACY_MONGO

docker inspect "%LEGACY_MONGO_CONTAINER%" >nul 2>&1


if errorlevel 1 goto :CREATE_MONGO


rem ------------------------------------------------------------
rem Migrate the old container (published on 0.0.0.0, no auth):
rem add the admin user to its data, remove the container, and
rem recreate it on the same volume bound to 127.0.0.1 with auth.
rem ------------------------------------------------------------

echo       Securing the existing demo MongoDB...
echo       (binding to 127.0.0.1 and enabling authentication)


docker start "%LEGACY_MONGO_CONTAINER%" >nul 2>&1


if errorlevel 1 goto :MONGO_SECURE_ERROR


for /L %%I in (1,1,45) do (
    docker exec "%LEGACY_MONGO_CONTAINER%" mongosh --quiet --eval "db.runCommand({ping:1})" >nul 2>&1

    if not errorlevel 1 goto :LEGACY_MONGO_READY

    timeout /t 2 /nobreak >nul
)


goto :MONGO_SECURE_ERROR



:LEGACY_MONGO_READY

docker exec "%LEGACY_MONGO_CONTAINER%" mongosh --quiet admin --eval "if (db.getUser('%MONGO_USER%')) { db.changeUserPassword('%MONGO_USER%', '%MONGO_PASSWORD%') } else { db.createUser({ user: '%MONGO_USER%', pwd: '%MONGO_PASSWORD%', roles: [{ role: 'root', db: 'admin' }] }) }" >nul


if errorlevel 1 goto :MONGO_SECURE_ERROR


docker stop "%LEGACY_MONGO_CONTAINER%" >nul 2>&1

docker rm "%LEGACY_MONGO_CONTAINER%" >nul 2>&1


if errorlevel 1 goto :MONGO_SECURE_ERROR


echo       Old container removed. Data volume kept: %MONGO_VOLUME%


goto :MONGO_VOLUME_READY



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


rem -p 127.0.0.1:... keeps MongoDB off the LAN. MONGO_INITDB_* create
rem the admin user on a fresh volume; --auth enforces credentials
rem on an existing volume as well.
docker run -d --name "%MONGO_CONTAINER%" --restart unless-stopped -p 127.0.0.1:%MONGO_PORT%:27017 -e MONGO_INITDB_ROOT_USERNAME=%MONGO_USER% -e MONGO_INITDB_ROOT_PASSWORD=%MONGO_PASSWORD% -v "%MONGO_VOLUME%:/data/db" mongo:7 --auth >nul


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
    docker exec "%MONGO_CONTAINER%" mongosh --quiet %MONGO_SHELL_AUTH% --eval "db.runCommand({ping:1})" >nul 2>&1

    if not errorlevel 1 goto :MONGO_READY

    timeout /t 2 /nobreak >nul
)


goto :MONGO_TIMEOUT



:MONGO_READY

echo       MongoDB is ready.
echo       Address : 127.0.0.1:%MONGO_PORT% (authentication on)
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

rem Background workers run inside the server process
rem (backend/src/workers/inProcessWorkers.js). The Padron refresh
rem stays with the separate updater started in step 4.
set "BATCH_INVOICE_WORKER_ENABLED=true"

set "SLA_WORKER_ENABLED=true"

set "SUNAT_PADRON_WORKER_ENABLED=false"

set "SLA_DUE_SOON_HOURS=4"

set "SLA_ESCALATION_HOURS=24"

set "SLA_POLL_MS=60000"

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


if errorlevel 1 goto :MONGO_PASSWORD_ERROR

echo.
echo [ERROR] Could not create or read the local MongoDB password.
echo.
echo File:
echo     %MONGO_PASSWORD_FILE%
echo.
goto :FAIL



:MONGO_PASSWORD_LOST

echo.
echo [ERROR] The secured MongoDB container exists but its password
echo         file was missing, so a new password was generated.
echo.
echo Restore the original file:
echo     %MONGO_PASSWORD_FILE%
echo.
echo or, to start over with an EMPTY demo database, run:
echo     docker rm -f %MONGO_CONTAINER%
echo     docker volume rm %MONGO_VOLUME%
echo.
del /q "%MONGO_PASSWORD_FILE%" >nul 2>&1
goto :FAIL



:MONGO_SECURE_ERROR

echo.
echo [ERROR] Could not secure the existing demo MongoDB container:
echo     %LEGACY_MONGO_CONTAINER%
echo.
docker logs --tail 30 "%LEGACY_MONGO_CONTAINER%" 2>nul
echo.
goto :FAIL



:JWT_ERROR



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


docker exec "%MONGO_CONTAINER%" mongosh --quiet %MONGO_SHELL_AUTH% "mongodb://127.0.0.1:27017/%MONGO_DB%" --eval "print(db.users.countDocuments({}))" > "%COUNT_FILE%" 2>nul


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


echo       Stopping previous standalone workers if present...


powershell -NoProfile -ExecutionPolicy Bypass -Command "$items=Get-CimInstance Win32_Process -ErrorAction SilentlyContinue; foreach($item in $items){if($item.Name -eq 'node.exe' -and ($item.CommandLine -like '*batchInvoiceWorker.js*' -or $item.CommandLine -like '*slaWorker.js*')){Stop-Process -Id $item.ProcessId -Force -ErrorAction SilentlyContinue}}" >nul 2>&1


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
rem STEP 8 - START DEMO SERVER (WITH BATCH AND SLA WORKERS)
rem ============================================================

echo [8/9] Starting UMA Finance demo server...


echo       Starting server (A2 batch + SLA workers in-process)...


start "UMA Finance - DEMO Server" cmd.exe /k "npm run start:public"


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
echo              DEMO IS ONLINE (DEMO ONLY)
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
echo     MongoDB : 127.0.0.1:%MONGO_PORT% (authentication on)
echo     Database: %MONGO_DB%
echo     Password: .uma-local-mongo-password (keep private)
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
echo BACKGROUND WORKERS (inside the demo server):
echo.
echo     A2 Batch Worker     : RUNNING
echo     SLA Escalation      : RUNNING
echo.
echo ============================================================
echo.
echo PUBLIC LINK COPIED TO CLIPBOARD
echo.
echo DEMO ONLY - share this temporary URL only with demo viewers:
echo.
echo     %PUBLIC_URL%
echo.
echo ============================================================
echo.
echo IMPORTANT:
echo.
echo - Keep this PC powered on.
echo - Keep Docker Desktop running.
echo - Keep the DEMO Server window running.
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
echo MongoDB, or ngrok.
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
echo     UMA Finance - DEMO Server
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
