# Run from the UMA project root after extracting the updated-files archive here.
# This only removes dedicated Contracts source modules, NOT MongoDB data or uploaded files.
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
if (-not (Test-Path (Join-Path $root 'backend\src\routes\index.js')) -or -not (Test-Path (Join-Path $root 'frontend\src\App.jsx'))) {
  throw 'Extract the changed-files ZIP into the finance-main project root (the folder containing backend and frontend) before running this script.'
}
$index = Get-Content -LiteralPath (Join-Path $root 'backend\src\routes\index.js') -Raw
if ($index -match 'umaContractRoutes') {
  throw 'Updated routes/index.js has not been installed. Extract the ZIP with -Force first; no old source has been deleted.'
}
$oldModules = @(
  'frontend/src/pages/UmaContracts.jsx',
  'backend/src/routes/umaContractRoutes.js',
  'backend/src/services/umaContractService.js',
  'backend/src/models/UmaContract.js',
  'backend/src/models/UmaContractInvoice.js',
  'shared/umaContractRules.mjs',
  'backend/test/umaContractRules.test.js'
)
foreach ($rel in $oldModules) {
  $file = Join-Path $root $rel
  if (Test-Path -LiteralPath $file -PathType Leaf) {
    Remove-Item -LiteralPath $file -Force
    Write-Host "Removed: $rel"
  } else {
    Write-Host "Already absent: $rel"
  }
}
Write-Host 'Contracts page/API disabled; database and uploaded documents untouched.'
Write-Host 'Now run: node --test .\backend\test\removedContractsFeature.test.js'
