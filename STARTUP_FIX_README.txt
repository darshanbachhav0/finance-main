UMA Finance Startup Repair — October 27, 2026

This archive repairs NEW code modules that the prior delta archive did not contain.
Most importantly: backend/src/services/statementCsv.js, imported by statementReviewRoutes.js.
It does not modify your .env, MongoDB, or existing employee assignments.

In PowerShell, from the folder containing backend and frontend:

  Expand-Archive -Path "$env:USERPROFILE\Downloads\UMA_Finance_Startup_Missing_Modules_Fix.zip" -DestinationPath "." -Force
  Test-Path ".\backend\src\services\statementCsv.js"
  node --check ".\backend\src\services\statementCsv.js"

If port 5174 is occupied, inspect the owner:
  Get-NetTCPConnection -LocalPort 5174 -State Listen -ErrorAction SilentlyContinue | Select-Object OwningProcess
  Get-Process -Id (Get-NetTCPConnection -LocalPort 5174 -State Listen).OwningProcess
Close the old Vite terminal or stop its confirmed stale process.
Then restart:
  npm run dev

Do not copy the archive into backend; extract at project root only.
