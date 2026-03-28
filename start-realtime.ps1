Push-Location "$PSScriptRoot\realtime"
if (-not (Test-Path "node_modules")) {
  npm install
}
npm run dev
Pop-Location
