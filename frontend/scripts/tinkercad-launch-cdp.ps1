# Launch a dedicated Chrome with remote debugging enabled, using a private
# user-data-dir so it has its own cookie jar. Log into Tinkercad once in this
# window; the session persists across reboots.
#
# Usage:   pwsh -File scripts/tinkercad-launch-cdp.ps1
#          (leave the window open; Playwright connects to port 9222)

$ChromeExe = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$ProfileDir = Join-Path $env:LOCALAPPDATA "TinkercadCDP"
$Port = 9222
$StartUrl = "https://www.tinkercad.com/dashboard"

if (-not (Test-Path $ChromeExe)) {
  Write-Error "Chrome not found at $ChromeExe"
  exit 1
}

if (-not (Test-Path $ProfileDir)) {
  New-Item -ItemType Directory -Path $ProfileDir | Out-Null
  Write-Host "Created profile dir: $ProfileDir" -ForegroundColor Green
}

# Reject if a previous CDP Chrome on this profile is already running.
$existing = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue
if ($existing) {
  Write-Host "Chrome with CDP already running on port $Port. Reusing." -ForegroundColor Yellow
  exit 0
}

Write-Host "Launching Chrome with CDP on port $Port..." -ForegroundColor Cyan
Write-Host "Profile: $ProfileDir" -ForegroundColor DarkGray
Write-Host "Log into Tinkercad in the spawned window. The cookie persists across reboots."  -ForegroundColor Yellow

Start-Process -FilePath $ChromeExe -ArgumentList @(
  "--remote-debugging-port=$Port",
  "--user-data-dir=`"$ProfileDir`"",
  "--no-first-run",
  "--no-default-browser-check",
  $StartUrl
)

Write-Host "Done. Connect Playwright via: chromium.connectOverCDP('http://127.0.0.1:$Port')" -ForegroundColor Green
