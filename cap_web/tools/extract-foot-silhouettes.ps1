Add-Type -AssemblyName System.Drawing

$sourcePath = Join-Path $PSScriptRoot "..\assets\foot-shapes-reference.png"
$source = [System.Drawing.Bitmap]::new($sourcePath)
$width = 223
$height = $source.Height

function Export-FootSilhouette {
  param(
    [System.Drawing.Bitmap]$SourceBitmap,
    [string]$DestinationPath,
    [int]$StartX
  )

  $output = [System.Drawing.Bitmap]::new($width, $height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  for ($x = 0; $x -lt $width; $x++) {
    for ($y = 0; $y -lt $height; $y++) {
      $pixel = $SourceBitmap.GetPixel($StartX + $x, $y)
      $luminance = ($pixel.R + $pixel.G + $pixel.B) / 3
      $alpha = [Math]::Min(255, [Math]::Max(0, [int]((245 - $luminance) * 2.4)))
      $color = [System.Drawing.Color]::FromArgb($alpha, 88, 189, 154)
      $output.SetPixel($x, $y, $color)
    }
  }
  $output.Save($DestinationPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $output.Dispose()
}

try {
  Export-FootSilhouette -SourceBitmap $source -DestinationPath (Join-Path $PSScriptRoot "..\assets\foot-left-silhouette.png") -StartX 0
  Export-FootSilhouette -SourceBitmap $source -DestinationPath (Join-Path $PSScriptRoot "..\assets\foot-right-silhouette.png") -StartX 224
}
finally {
  $source.Dispose()
}
