# Set development API URL
param([string]$ApiUrl)

if (-not $ApiUrl) {
    Write-Host "Usage: .\set-dev-api-url.ps1 <api-url>" -ForegroundColor Yellow
    exit 1
}

$env:EXPO_PUBLIC_API_URL = $ApiUrl
Write-Host "Development API URL set to: $ApiUrl" -ForegroundColor Green
