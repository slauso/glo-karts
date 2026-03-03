Add-Type -AssemblyName System.IO.Compression.FileSystem
$zipPath = "C:\Users\laptop\twistedkart\third_party\SuperTuxKart-1.5-win.zip"
$destPath = "C:\Users\laptop\twistedkart\frontend\public\audio"

if (-not (Test-Path $destPath)) { New-Item -ItemType Directory -Force -Path $destPath | Out-Null }

Write-Host "Opening zip file..."
$zip = [System.IO.Compression.ZipFile]::OpenRead($zipPath)

Write-Host "Extracting music and sfx..."
foreach ($entry in $zip.Entries) {
    if ($entry.FullName -match "^SuperTuxKart-1\.5-win/stk-code/data/(music|sfx)/") {
        $relativePath = $entry.FullName -replace "^SuperTuxKart-1\.5-win/stk-code/data/", ""
        $targetFile = Join-Path $destPath $relativePath
        
        if ($entry.FullName.EndsWith("/")) {
            if (-not (Test-Path $targetFile)) { New-Item -ItemType Directory -Force -Path $targetFile | Out-Null }
        } else {
            $targetDir = Split-Path $targetFile -Parent
            if (-not (Test-Path $targetDir)) { New-Item -ItemType Directory -Force -Path $targetDir | Out-Null }
            [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $targetFile, $true)
        }
    }
}
$zip.Dispose()
Write-Host "Audio extraction complete!"
