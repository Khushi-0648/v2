Add-Type -AssemblyName System.Drawing

function Create-AppIcon([int]$size, [string]$outputPath) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

    # Dark background with rounded rectangle
    $bgBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(11, 19, 41))
    $g.FillRectangle($bgBrush, 0, 0, $size, $size)

    # Cyan/Emerald radial gradient circle
    $center = $size / 2
    $radius = $size * 0.42
    $rect = New-Object System.Drawing.RectangleF(($center - $radius), ($center - $radius), ($radius * 2), ($radius * 2))
    
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddEllipse($rect)
    $pbr = New-Object System.Drawing.Drawing2D.PathGradientBrush($path)
    $pbr.CenterColor = [System.Drawing.Color]::FromArgb(14, 165, 233)
    $pbr.SurroundColors = @([System.Drawing.Color]::FromArgb(3, 105, 161))
    $g.FillEllipse($pbr, $rect)

    # Outer neon ring
    $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(16, 185, 129), ($size * 0.03))
    $g.DrawEllipse($pen, $rect)

    # White & Cyan Camera body
    $camW = $size * 0.40
    $camH = $size * 0.28
    $camX = ($size - $camW) / 2 - ($size * 0.04)
    $camY = ($size - $camH) / 2
    $camBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 255, 255))
    $g.FillRectangle($camBrush, $camX, $camY, $camW, $camH)

    # Camera lens triangle
    $tX1 = $camX + $camW + ($size * 0.02)
    $tY1 = $camY + ($camH * 0.15)
    $tX2 = $tX1 + ($size * 0.12)
    $tY2 = $camY - ($camH * 0.10)
    $tX3 = $tX2
    $tY3 = $camY + $camH + ($camH * 0.10)
    $tX4 = $tX1
    $tY4 = $camY + $camH - ($camH * 0.15)

    $lensPath = New-Object System.Drawing.Drawing2D.GraphicsPath
    $lensPoints = @(
        (New-Object System.Drawing.PointF($tX1, $tY1)),
        (New-Object System.Drawing.PointF($tX2, $tY2)),
        (New-Object System.Drawing.PointF($tX3, $tY3)),
        (New-Object System.Drawing.PointF($tX4, $tY4))
    )
    $lensPath.AddPolygon($lensPoints)
    $lensBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(16, 185, 129))
    $g.FillPath($lensBrush, $lensPath)

    # "V2" badge text inside camera
    $fontSize = [float]($size * 0.14)
    $font = New-Object System.Drawing.Font("Arial", $fontSize, [System.Drawing.FontStyle]::Bold)
    $textBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(11, 19, 41))
    $sf = New-Object System.Drawing.StringFormat
    $sf.Alignment = [System.Drawing.StringAlignment]::Center
    $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
    $camRect = New-Object System.Drawing.RectangleF($camX, $camY, $camW, $camH)
    $g.DrawString("V2", $font, $textBrush, $camRect, $sf)

    # Save
    $bmp.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)

    $font.Dispose()
    $camBrush.Dispose()
    $lensBrush.Dispose()
    $textBrush.Dispose()
    $pen.Dispose()
    $pbr.Dispose()
    $path.Dispose()
    $bgBrush.Dispose()
    $g.Dispose()
    $bmp.Dispose()
}

Create-AppIcon 192 "public\icon-192.png"
Create-AppIcon 512 "public\icon-512.png"
Create-AppIcon 512 "public\icon-maskable.png"
Write-Host "Icons generated successfully!"
