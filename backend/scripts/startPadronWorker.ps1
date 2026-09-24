# Local Windows development only. In production the padron worker runs as the
# `uma-finance-padron-worker` background service defined in render.yaml.
param([Parameter(Mandatory=$true)][string]$ProjectDir,[Parameter(Mandatory=$true)][string]$DataDir)
$ErrorActionPreference = "Stop"
$projectPath = (Resolve-Path -LiteralPath $ProjectDir).Path
$nodePath = (Get-Command node -ErrorAction Stop).Source
$workerPath = Join-Path $projectPath "backend\scripts\padronWorker.js"
$legacyPath = Join-Path $projectPath "backend\data\sunat-padron"
# Encode the command so paths with spaces and apostrophes remain literal.
function Quote-Literal([string]$Value) { return "'" + $Value.Replace("'", "''") + "'" }
$commandText = '$env:SUNAT_PADRON_DATA_DIR=' + (Quote-Literal $DataDir) + '; $env:SUNAT_PADRON_LEGACY_DIR=' + (Quote-Literal $legacyPath) + '; Set-Location -LiteralPath ' + (Quote-Literal $projectPath) + '; & ' + (Quote-Literal $nodePath) + ' ' + (Quote-Literal $workerPath)
$encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($commandText))
$arguments = "-NoProfile -WindowStyle Hidden -EncodedCommand $encoded"
try {
  $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $arguments
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name)
  $settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
  Register-ScheduledTask -TaskName "UMA SUNAT Padron Updater" -Action $action -Trigger $trigger -Settings $settings -Description "Maintains UMA public RUC data independently from the web application." -Force | Out-Null
  Start-ScheduledTask -TaskName "UMA SUNAT Padron Updater"
  Write-Host "SUNAT updater registered for login and started in the background."
} catch {
  Write-Warning "Task registration unavailable. Starting the worker for this Windows session: $($_.Exception.Message)"
  Start-Process -FilePath "powershell.exe" -ArgumentList $arguments -WindowStyle Hidden
}
