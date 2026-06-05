Add-Type -AssemblyName System.Drawing

$src = Join-Path $PSScriptRoot 'logo.png'
$icoPath = Join-Path $PSScriptRoot 'logo.ico'
$lnkPath = Join-Path ([Environment]::GetFolderPath("Desktop")) 'RCM POS.lnk'

# Convert PNG to ICO (256x256)
$bmp = New-Object System.Drawing.Bitmap($src)
$resized = New-Object System.Drawing.Bitmap(256, 256)
$g = [System.Drawing.Graphics]::FromImage($resized)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.DrawImage($bmp, 0, 0, 256, 256)
$g.Dispose()

$hicon = $resized.GetHicon()
$icon = [System.Drawing.Icon]::FromHandle($hicon)
$fs = [System.IO.File]::OpenWrite($icoPath)
$icon.Save($fs)
$fs.Close()
$icon.Dispose()
$resized.Dispose()
$bmp.Dispose()
Write-Host "ICO created successfully."

# Find Chrome or Edge path
$chromePath = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$edgePath   = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"

if (Test-Path $chromePath) {
    $browserPath = $chromePath
} elseif (Test-Path $edgePath) {
    $browserPath = $edgePath
} else {
    # Try to find chrome in other locations
    $chromeCmd = Get-Command chrome -ErrorAction SilentlyContinue
    if ($chromeCmd) {
        $browserPath = $chromeCmd.Source
    } else {
        $browserPath = $edgePath
    }
}

Write-Host "Using browser: $browserPath"

# Create .lnk shortcut with custom icon
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($lnkPath)
$shortcut.TargetPath  = $browserPath
$indexPath = (Join-Path $PSScriptRoot 'index.html').Replace('\', '/')
$shortcut.Arguments   = '--app="file:///' + $indexPath + '" --start-maximized --disable-extensions'
$shortcut.IconLocation = "$icoPath,0"
$shortcut.Description  = 'RCM POS System'
$shortcut.WorkingDirectory = $PSScriptRoot
$shortcut.Save()

Write-Host "Desktop shortcut created: $lnkPath"
Write-Host "Done!"
