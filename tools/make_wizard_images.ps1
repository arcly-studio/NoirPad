<#
.SYNOPSIS
    Regenerates the installer's wizard images from the logo.

.DESCRIPTION
    installer\wizard-small-<size>.bmp (32-bit with alpha, one per DPI scale)
    from docs\brand\noirpad-1024.png, the raster export of
    docs\brand\noirpad-icon.svg. Inno Setup picks the size that fits the
    screen's scaling (WizardSmallImageFile in installer.iss). Run it after
    the logo changes and commit the BMPs; build.ps1 does not run it.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File tools\make_wizard_images.ps1
#>
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$source = Join-Path $root "docs\brand\noirpad-1024.png"
$outDir = Join-Path $root "installer"
New-Item -ItemType Directory -Force $outDir | Out-Null

# 100 %, 125 %, 125 % (classic), 150 %, 175 %, 200 %, 250 %
$sizes = 55, 64, 69, 83, 92, 110, 138

$src = [System.Drawing.Image]::FromFile($source)
try {
    foreach ($size in $sizes) {
        $bmp = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        $g.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
        $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
        $g.Clear([System.Drawing.Color]::Transparent)
        $g.DrawImage($src, 0, 0, $size, $size)
        $g.Dispose()
        $out = Join-Path $outDir "wizard-small-$size.bmp"
        $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Bmp)
        $bmp.Dispose()
        Write-Host "$out"
    }
} finally {
    $src.Dispose()
}
