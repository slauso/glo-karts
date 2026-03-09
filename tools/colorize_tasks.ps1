$f = "c:\Users\laptop\twistedkart\DEVELOPMENT_TASK_LIST.txt"
$content = [System.IO.File]::ReadAllText($f, [System.Text.Encoding]::UTF8)

# Emoji definitions using ConvertFromUtf32 for characters above U+FFFF
$green  = [char]::ConvertFromUtf32(0x1F7E2)   # Green circle for DONE
$red    = [char]::ConvertFromUtf32(0x1F534)   # Red circle for TODO
$yellow = [char]::ConvertFromUtf32(0x1F7E1)   # Yellow circle for IN PROGRESS
$orange = [char]::ConvertFromUtf32(0x1F7E0)   # Orange circle for BLOCKED
$black  = [string][char]0x26AB                 # Black circle for CUT (BMP, single char)
$blue   = [char]::ConvertFromUtf32(0x1F535)   # Blue circle for SKIP

# Simple string replacement - replace all [STATUS] with emoji + [STATUS]
$content = $content.Replace('[DONE]', "$green [DONE]")
$content = $content.Replace('[IN PROGRESS]', "$yellow [IN PROGRESS]")
$content = $content.Replace('[TODO]', "$red [TODO]")
$content = $content.Replace('[BLOCKED]', "$orange [BLOCKED]")
$content = $content.Replace('[CUT]', "$black [CUT]")
$content = $content.Replace('[SKIP]', "$blue [SKIP]")

# Write back with UTF-8 (no BOM)
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($f, $content, $utf8NoBom)

# Count results
$final = [System.IO.File]::ReadAllText($f, $utf8NoBom)
$doneCount = ([regex]::Matches($final, $green)).Count
$todoCount = ([regex]::Matches($final, $red)).Count
$ipCount   = ([regex]::Matches($final, $yellow)).Count
$blockCount = ([regex]::Matches($final, $orange)).Count
$cutCount  = ([regex]::Matches($final, $black)).Count
$skipCount = ([regex]::Matches($final, $blue)).Count

Write-Output "COLORIZE COMPLETE"
Write-Output "Green (DONE): $doneCount"
Write-Output "Red (TODO): $todoCount"  
Write-Output "Yellow (IN PROGRESS): $ipCount"
Write-Output "Orange (BLOCKED): $blockCount"
Write-Output "Black (CUT): $cutCount"
Write-Output "Blue (SKIP): $skipCount"
Write-Output "Total tagged: $($doneCount + $todoCount + $ipCount + $blockCount + $cutCount + $skipCount)"
