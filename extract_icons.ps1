Add-Type -AssemblyName System.IO.Compression.FileSystem
$zipPath = "C:\Users\laptop\twistedkart\third_party\SuperTuxKart-1.5-win.zip"
$destPath = "C:\Users\laptop\twistedkart\frontend\public\textures\items"

if (-not (Test-Path $destPath)) { New-Item -ItemType Directory -Force -Path $destPath | Out-Null }

Write-Host "Opening zip file..."
$zip = [System.IO.Compression.ZipFile]::OpenRead($zipPath)

Write-Host "Extracting item icons..."
foreach ($entry in $zip.Entries) {
    if ($entry.FullName -match "^SuperTuxKart-1\.5-win/stk-code/data/gui/icons/(gift|nitro|bubblegum-icon|bowling-icon|cake-icon|plunger-icon|swatter-icon|parachute-icon|anchor-icon)\.png") {
        $fileName = Split-Path $entry.FullName -Leaf
        $targetFile = Join-Path $destPath $fileName
        [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $targetFile, $true)
    }
}
$zip.Dispose()
Write-Host "Icon extraction complete!"
