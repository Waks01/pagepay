# Start Expo dev server with your LAN IP for development builds
# This script automatically detects your Wi-Fi IP and sets it for Metro bundler

Write-Host "Finding your Wi-Fi IP address..." -ForegroundColor Cyan

# Get Wi-Fi adapter IPv4 address
$ip = (Get-NetIPAddress -AddressFamily IPv4 -InterfaceAlias "Wi-Fi" -ErrorAction SilentlyContinue).IPAddress

if (-not $ip) {
    Write-Host "Could not find Wi-Fi adapter. Trying Ethernet..." -ForegroundColor Yellow
    $ip = (Get-NetIPAddress -AddressFamily IPv4 -InterfaceAlias "Ethernet" -ErrorAction SilentlyContinue).IPAddress
}

if (-not $ip) {
    Write-Host "ERROR: Could not detect network IP. Please check your network connection." -ForegroundColor Red
    exit 1
}

Write-Host "Found IP: $ip" -ForegroundColor Green
Write-Host "Starting Expo dev server..." -ForegroundColor Cyan
Write-Host ""

# Set environment variable and start Expo
$env:REACT_NATIVE_PACKAGER_HOSTNAME = $ip
npm start
