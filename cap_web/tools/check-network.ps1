param([string]$DeviceIp = '')
# Read-only diagnostics. No credentials, registration, firewall or outputs are changed.
$ErrorActionPreference = 'Stop'

function Test-PrivateV4([string]$Value) {
  $parsed = $null
  if (-not [Net.IPAddress]::TryParse($Value, [ref]$parsed)) { return $false }
  if ($parsed.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork) { return $false }
  $bytes = $parsed.GetAddressBytes()
  return ($bytes[0] -eq 10 -or ($bytes[0] -eq 172 -and $bytes[1] -ge 16 -and $bytes[1] -le 31) -or ($bytes[0] -eq 192 -and $bytes[1] -eq 168))
}

if ($DeviceIp -and -not (Test-PrivateV4 $DeviceIp)) { throw 'DeviceIp must be the ESP32 private IPv4 address shown in its serial monitor.' }
Write-Host 'StepOn phone hotspot / router connection check'
Write-Host 'Connect the laptop and both ESP32 boards to the same 2.4 GHz Wi-Fi.'
try {
  $networks = @(Get-NetIPConfiguration -ErrorAction Stop | Where-Object { $_.IPv4Address -and $_.NetAdapter.Status -eq 'Up' })
  $found = $false
  foreach ($network in $networks) {
    foreach ($address in $network.IPv4Address) {
      $ip = $address.IPAddress
      if (-not (Test-PrivateV4 $ip)) { continue }
      $found = $true
      Write-Host ("`nAdapter: {0} / Laptop IPv4: {1} / Gateway: {2}" -f $network.InterfaceAlias, $ip, ($network.IPv4DefaultGateway.NextHop -join ', '))
      Write-Host ('For this network, config.h: constexpr const char *PC_HOST = "' + $ip + '";')
      Write-Host ("Phone browser: http://{0}:8000/mobile?esp32=1&transport=sta&ai=1" -f $ip)
    }
  }
  if (-not $found) { Write-Host 'No active private IPv4 found. Connect to the hotspot, then run ipconfig.' }
} catch { Write-Host 'Network adapter lookup failed. Run ipconfig and use the Wi-Fi IPv4 address.' }

try {
  $listeners = @(Get-NetTCPConnection -State Listen -LocalPort 8000 -ErrorAction Stop)
  $addresses = @($listeners | ForEach-Object { $_.LocalAddress })
  Write-Host ("`nWeb port 8000 listening on: " + ($addresses -join ', '))
  if (-not ($addresses | Where-Object { $_ -notin @('127.0.0.1', '::1') })) {
    Write-Host 'Loopback only: finish recordings, stop the manual server, then start run.bat.'
  }
} catch { Write-Host "`nWeb port 8000 listener not found. Start run.bat." }

try {
  $hub = Invoke-RestMethod 'http://127.0.0.1:8000/api/insoles/state' -TimeoutSec 3
  if ($hub.service -ne 'stepon-bilateral-v1') { throw 'Unexpected service' }
  foreach ($side in @('left', 'right')) {
    $foot = $hub.feet.$side
    Write-Host ("{0}: {1}; address={2}; connected={3}" -f $side, $foot.status, $foot.base_url, $foot.connected)
  }
} catch { Write-Host 'StepOn collector unavailable. Start run.bat and check .codex-output logs.' }

if ($DeviceIp) {
  try {
    $ping = Invoke-RestMethod ("http://{0}/api/ping" -f $DeviceIp) -TimeoutSec 3
    Write-Host ("ESP32: firmware={0}; foot={1}; device={2}" -f $ping.firmware, $ping.foot_side, $ping.device_id)
    if ($ping.firmware -notin @('04_sta_bilateral', '04_2_sta_bilateral_wroom')) {
      Write-Host 'Use 04 C3 or 4-2 WROOM STA firmware for wireless web integration.'
    }
  } catch { Write-Host 'ESP32 API did not respond. Check its current IP, power, Wi-Fi and hotspot peer connectivity.' }
}
Write-Host "`nA local web response does not prove that another device can reach this laptop."
Write-Host 'On a phone hotspot, PC_HOST is the laptop IPv4 above; the gateway is usually the phone.'
Write-Host 'ESP32 serial: [PC] registration HTTP=200; then confirm live IMU frames in the web.'
Write-Host 'If needed, allow the StepOn Node server inbound TCP 8000 on this local network.'
Write-Host 'Guide: docs\PHONE_HOTSPOT.md'
