# Tunel de Cloudflare para jugar con amigos (lo usa "3 - JUGAR ONLINE CON AMIGOS.bat").
# Abre cloudflared, espera la direccion .trycloudflare.com, la muestra bien grande y la copia al portapapeles.
param([Parameter(Mandatory = $true)][string]$Cf)

$log = Join-Path $env:TEMP "caballos-tunel.log"
Remove-Item $log -ErrorAction SilentlyContinue
Write-Host "Creando el túnel de Cloudflare, tarda unos segundos..."
$p = Start-Process -FilePath $Cf -ArgumentList @("tunnel", "--url", "http://127.0.0.1:8787") -RedirectStandardError $log -NoNewWindow -PassThru

$url = $null
for ($i = 0; $i -lt 120 -and -not $url; $i++) {
  Start-Sleep -Milliseconds 500
  if ($p.HasExited) { break }
  if (Test-Path $log) {
    $texto = Get-Content -Path $log -Raw -ErrorAction SilentlyContinue
    if ($texto -match "https://[a-z0-9-]+\.trycloudflare\.com") { $url = $Matches[0] }
  }
}

if (-not $url) {
  Write-Host ""
  Write-Host "No apareció la dirección del túnel. Esto dijo cloudflared:" -ForegroundColor Red
  if (Test-Path $log) { Get-Content -Path $log -Tail 15 }
  Write-Host ""
  Write-Host "Sacale una foto a esta ventana y pasasela a Claude." -ForegroundColor Red
  if (-not $p.HasExited) { Stop-Process -Id $p.Id -ErrorAction SilentlyContinue }
  exit 1
}

$copiada = $false
try { Set-Clipboard -Value $url; $copiada = $true } catch { }

Write-Host ""
Write-Host "  ================================================================" -ForegroundColor Yellow
Write-Host "    PASALE ESTA DIRECCIÓN A TU AMIGO:" -ForegroundColor Yellow
Write-Host ""
Write-Host "        $url" -ForegroundColor Green
Write-Host ""
if ($copiada) { Write-Host "    Ya está copiada: pegala en WhatsApp o Discord con Ctrl + V." -ForegroundColor Yellow }
Write-Host "  ================================================================" -ForegroundColor Yellow
Write-Host ""
Write-Host "  - Si apenas la abre le da error, que espere medio minuto y recargue."
Write-Host "  - Vos jugás en http://127.0.0.1:8787 (esa SOLO funciona en tu compu)."
Write-Host "  - Cada uno crea su cuenta y va a Carreras -> Online casual."
Write-Host "  - La dirección cambia cada vez que abrís el .bat."
Write-Host "  - No cierres esta ventana mientras juegan. Para terminar: Ctrl + C."
Write-Host ""
Wait-Process -Id $p.Id
