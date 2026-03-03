Set-Location $PSScriptRoot\backend
$env:DEBUG = "True"
$env:CORS_ALLOW_ALL_ORIGINS = "True"
Write-Host "Starting Django backend on port 8002..."
& .\venv\Scripts\python.exe manage.py runserver 8002
