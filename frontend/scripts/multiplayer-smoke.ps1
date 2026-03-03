$ErrorActionPreference = 'Stop'
$results = @()

function Add-Result($name, $ok, $details) {
  $script:results += [PSCustomObject]@{
    Check   = $name
    Status  = if ($ok) { 'PASS' } else { 'FAIL' }
    Details = $details
  }
}

try {
  $health = Invoke-WebRequest -UseBasicParsing http://localhost:8000/
  Add-Result 'Backend reachable' ($health.StatusCode -eq 200) ("HTTP $($health.StatusCode)")
} catch {
  Add-Result 'Backend reachable' $false $_.Exception.Message
}

try {
  $front = Invoke-WebRequest -UseBasicParsing http://localhost:5173/
  Add-Result 'Frontend reachable' ($front.StatusCode -eq 200) ("HTTP $($front.StatusCode)")
} catch {
  Add-Result 'Frontend reachable' $false $_.Exception.Message
}

$peerId = "smoke-host-" + [Guid]::NewGuid().ToString('N').Substring(0,10)
$createdCode = $null
try {
  $createResp = Invoke-RestMethod -Method Post -Uri http://localhost:8000/api/party-codes/create/ -ContentType 'application/json' -Body (@{ peer_id = $peerId } | ConvertTo-Json)
  $createdCode = $createResp.code
  Add-Result 'Party create API' (-not [string]::IsNullOrWhiteSpace($createdCode)) ("code=$createdCode, peer=$($createResp.peer_id)")
} catch {
  Add-Result 'Party create API' $false $_.Exception.Message
}

try {
  if ($createdCode) {
    $lookup = Invoke-RestMethod -Method Get -Uri ("http://localhost:8000/api/party-codes/lookup/{0}/" -f $createdCode)
    Add-Result 'Party lookup API' ($lookup.peer_id -eq $peerId) ("expected=$peerId, got=$($lookup.peer_id)")
  } else {
    Add-Result 'Party lookup API' $false 'Skipped because create failed'
  }
} catch {
  Add-Result 'Party lookup API' $false $_.Exception.Message
}

$lobbyPath = 'C:\Users\laptop\twistedkart\frontend\src\lobby.js'
if (Test-Path $lobbyPath) {
  $lobby = Get-Content $lobbyPath -Raw

  $startBroadcast = $lobby -match "broadcastToAll\(\{\s*type:\s*'startGame'"
  $startHandle    = $lobby -match "case\s*'startGame'"
  Add-Result 'Race start sync wiring' ($startBroadcast -and $startHandle) ("broadcast=$startBroadcast, handle=$startHandle")

  $bcBroadcast = $lobby -match "type:\s*'battleCountdown'"
  $bcHandle    = $lobby -match "case\s*'battleCountdown'"
  Add-Result 'Battle countdown sync wiring' ($bcBroadcast -and $bcHandle) ("broadcast=$bcBroadcast, handle=$bcHandle")

  $bsBroadcast = $lobby -match "type:\s*'battleStart'"
  $bsHandle    = $lobby -match "case\s*'battleStart'"
  Add-Result 'Battle start sync wiring' ($bsBroadcast -and $bsHandle) ("broadcast=$bsBroadcast, handle=$bsHandle")

  $configPersist = $lobby -match "sessionStorage\.setItem\('gameConfig'"
  Add-Result 'Game config persistence wiring' $configPersist ("sessionStorage write found=$configPersist")
} else {
  Add-Result 'Race start sync wiring' $false 'lobby.js not found'
  Add-Result 'Battle countdown sync wiring' $false 'lobby.js not found'
  Add-Result 'Battle start sync wiring' $false 'lobby.js not found'
  Add-Result 'Game config persistence wiring' $false 'lobby.js not found'
}

"`n=== Multiplayer Smoke Checklist ==="
$results | Format-Table -AutoSize

$overall = ($results | Where-Object { $_.Status -eq 'FAIL' }).Count -eq 0
"OVERALL: $(if ($overall) { 'PASS' } else { 'FAIL' })"

if (-not $overall) { exit 1 }
