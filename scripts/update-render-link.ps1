param(
  [switch]$Publish
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$stateFile = Join-Path $projectRoot ".tmp\cloudflare-share.json"
$linkFile = Join-Path $projectRoot "link-site\link.json"
$renderConfigFile = Join-Path $projectRoot "render.yaml"
$renderGatewayUrl = "https://uma-financial-access.onrender.com"

function Wait-RenderGateway($expectedTunnelUrl) {
  Write-Host "Waiting for the stable Render gateway to deploy..." -ForegroundColor Cyan

  for ($attempt = 1; $attempt -le 72; $attempt++) {
    try {
      $cacheBuster = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
      $publishedConfig = Invoke-RestMethod -Uri "$renderGatewayUrl/link.json?v=$cacheBuster" -Headers @{ "Cache-Control" = "no-cache" } -TimeoutSec 15
      if ($publishedConfig.url.TrimEnd("/") -eq $expectedTunnelUrl.TrimEnd("/")) {
        $health = Invoke-RestMethod -Uri "$renderGatewayUrl/health?v=$cacheBuster" -Headers @{ "Cache-Control" = "no-cache" } -TimeoutSec 20
        $login = Invoke-WebRequest -UseBasicParsing -Uri "$renderGatewayUrl/login?v=$cacheBuster" -Headers @{ "Cache-Control" = "no-cache" } -TimeoutSec 20
        if ($health.status -eq "ok" -and
          $health.service -eq "erp-financial-backend" -and
          $login.StatusCode -eq 200 -and
          $login.Headers['Content-Type'] -match "text/html") {
          return $true
        }
      }
    } catch {
      # Render can briefly return its deploy page or a gateway error during an atomic update.
    }

    Start-Sleep -Seconds 5
  }

  return $false
}

if (-not (Test-Path -LiteralPath $stateFile)) {
  throw "No active tunnel state was found. Run npm run share first."
}

$state = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
$tunnelProcess = Get-Process -Id $state.tunnelPid -ErrorAction SilentlyContinue
if (-not $tunnelProcess -or $tunnelProcess.ProcessName -ne "cloudflared") {
  throw "The saved Cloudflare tunnel is not running. Run npm run share first."
}

$uri = [Uri]$state.url
if ($uri.Scheme -ne "https" -or -not $uri.Host.EndsWith(".trycloudflare.com")) {
  throw "The saved tunnel URL is not a valid Cloudflare HTTPS address."
}

$configuration = [ordered]@{
  url = $state.url
  updatedAt = (Get-Date).ToString("o")
  active = $true
}
$json = $configuration | ConvertTo-Json
$utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($linkFile, "$json`n", $utf8WithoutBom)

$renderConfig = Get-Content -LiteralPath $renderConfigFile -Raw
$routePattern = '(?m)^(\s*destination:\s*)https://[a-z0-9-]+\.trycloudflare\.com/\*\s*$'
if ($renderConfig -notmatch $routePattern) {
  throw "The Render gateway rewrite was not found in render.yaml."
}
$renderConfig = [regex]::Replace($renderConfig, $routePattern, "`${1}$($state.url)/*", 1)
[System.IO.File]::WriteAllText($renderConfigFile, $renderConfig, $utf8WithoutBom)

Write-Host "Render gateway target updated:" -ForegroundColor Cyan
Write-Host $state.url -ForegroundColor Green

if (-not $Publish) {
  Write-Host "Publish it to Render with: npm run link:publish"
  exit 0
}

$git = (Get-Command "git.exe" -ErrorAction SilentlyContinue).Source
if (-not $git) {
  throw "Git was not found."
}

Push-Location $projectRoot
try {
  & $git diff --cached --quiet
  if ($LASTEXITCODE -ne 0) {
    throw "Other staged Git changes exist. Commit or unstage them before publishing the link."
  }

  & $git add -- "link-site/link.json" "render.yaml"
  if ($LASTEXITCODE -ne 0) {
    throw "Could not stage the Render gateway configuration."
  }

  & $git diff --cached --quiet -- "link-site/link.json" "render.yaml"
  if ($LASTEXITCODE -eq 0) {
    Write-Host "The published gateway target is already current." -ForegroundColor DarkGreen
    if (-not (Wait-RenderGateway $state.url)) {
      throw "The Render gateway did not become reachable. Check the latest Render deploy logs."
    }
    Write-Host "Stable gateway verified:" -ForegroundColor Cyan
    Write-Host $renderGatewayUrl -ForegroundColor Green
    exit 0
  }

  & $git commit -m "Update ERP gateway target" -- "link-site/link.json" "render.yaml"
  if ($LASTEXITCODE -ne 0) {
    throw "Could not commit the updated link."
  }

  & $git push origin HEAD
  if ($LASTEXITCODE -ne 0) {
    throw "The link was committed locally, but Git push failed. Check your GitHub sign-in."
  }

  Write-Host "Gateway target pushed. Render will deploy the update automatically." -ForegroundColor Green
  if (-not (Wait-RenderGateway $state.url)) {
    throw "The target was published, but the Render gateway did not become reachable. Check the latest Render deploy logs."
  }
  Write-Host "Stable gateway verified. Share only this address:" -ForegroundColor Cyan
  Write-Host $renderGatewayUrl -ForegroundColor Green
} finally {
  Pop-Location
}
