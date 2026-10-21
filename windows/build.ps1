$ErrorActionPreference = 'Stop'
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (!(Test-Path -LiteralPath $compiler)) { throw 'The Windows .NET Framework 4 compiler is required.' }
$output = Join-Path $PSScriptRoot 'dist'
New-Item -ItemType Directory -Path $output -Force | Out-Null
Add-Type -AssemblyName System.Drawing
$original = [System.Drawing.Image]::FromFile((Join-Path $PSScriptRoot '..\extension\images\icon128.png'))
# Windows executable icons support up to 256 pixels. Preserve all extension PNGs unchanged.
$bitmap = New-Object System.Drawing.Bitmap 256, 256
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$graphics.DrawImage($original, 0, 0, 256, 256)
$graphics.Dispose()
$original.Dispose()
$icon = [System.Drawing.Icon]::FromHandle($bitmap.GetHicon())
$iconPath = Join-Path $output 'thrash-pass.ico'
$stream = [System.IO.File]::Create($iconPath)
try { $icon.Save($stream) } finally { $stream.Dispose(); $icon.Dispose(); $bitmap.Dispose() }
$references = @('/r:System.Windows.Forms.dll', '/r:System.Drawing.dll', '/r:System.Web.Extensions.dll', '/r:System.IO.Compression.dll', '/r:System.IO.Compression.FileSystem.dll')
& $compiler /nologo /target:winexe /optimize+ /platform:anycpu "/win32icon:$iconPath" "/out:$output\THRASH-PASS-Updater.exe" @references (Join-Path $PSScriptRoot 'Updater.cs')
if ($LASTEXITCODE -ne 0) { throw 'Updater build failed.' }
& $compiler /nologo /target:exe /optimize+ /main:UpdaterTests "/out:$output\UpdaterTests.exe" @references (Join-Path $PSScriptRoot 'Updater.cs') (Join-Path $PSScriptRoot 'UpdaterTests.cs')
if ($LASTEXITCODE -ne 0) { throw 'Test build failed.' }
& (Join-Path $output 'UpdaterTests.exe')
if ($LASTEXITCODE -ne 0) { throw 'Updater tests failed.' }
Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $output 'THRASH-PASS-Updater.exe')
