Add-Type -AssemblyName System.Drawing

$src = 'C:\Users\User\Desktop\Rangana_Communication_POS\logo.png'
$icoPath = 'C:\Users\User\Desktop\Rangana_Communication_POS\logo.ico'
$lnkPath = 'C:\Users\User\Desktop\රංගන කමියුනිකේට්ශන් POS.lnk'

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
    $browserPath = (Get-Command chrome -ErrorAction SilentlyContinue)?.Source
    if (-not $browserPath) {
        $browserPath = $edgePath
    }
}

Write-Host "Using browser: $browserPath"

# Create .lnk shortcut with custom icon
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($lnkPath)
$shortcut.TargetPath  = $browserPath
$shortcut.Arguments   = '--app="file:///C:/Users/User/Desktop/Rangana_Communication_POS/index.html" --start-maximized --disable-extensions'
$shortcut.IconLocation = "$icoPath,0"
$shortcut.Description  = 'රංගන කමියුනිකේට්ශන් POS System'
$shortcut.WorkingDirectory = 'C:\Users\User\Desktop\Rangana_Communication_POS'
$shortcut.Save()

Write-Host "Desktop shortcut created: $lnkPath"
Write-Host "Done!"
