# Print development IP address
Write-Host "Finding your Wi-Fi IP address..." -ForegroundColor Cyan

$ip = (Get-NetIPAddress -AddressFamily IPv4 -InterfaceAlias "Wi-Fi" -ErrorAction SilentlyContinue).IPAddress

if (-not $ip) {
    Write-Host "Could not find Wi-Fi adapter. Trying Ethernet..." -ForegroundColor Yellow
    $ip = (Get-NetIPAddress -AddressFamily IPv4 -InterfaceAlias "Ethernet" -ErrorAction SilentlyContinue).IPAddress
}

if (-not $ip) {
    Write-Host "ERROR: Could not detect network IP. Please check your network connection." -ForegroundColor Red
    exit 1
}

Write-Host "Your development IP: $ip" -ForegroundColor Green
