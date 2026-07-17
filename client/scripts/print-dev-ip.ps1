# scripts/print-dev-ip.ps1
#
# Prints the dev machine's current LAN IPv4 without modifying any
# file. Useful when you want to know the IP before running
# `set-dev-api-url.ps1`, or to share the URL with a teammate / set
# up port forwarding on the dev backend.
#
# Usage:
#   pwsh ./scripts/print-dev-ip.ps1
#   npm run dev:ip
#
# Selection logic matches set-dev-api-url.ps1: prefer Wi-Fi adapter,
# skip loopback / link-local / vEthernet / Hyper-V. We re-implement
# the same parsing here (rather than dot-sourcing the other script)
# so the read-only helper stays decoupled from the rewrite path.

$ErrorActionPreference = 'Stop'

$adapters = @()
$current = $null
$ipconfigLines = ipconfig
foreach ($line in $ipconfigLines) {
    if ($line -match '^\s*([A-Za-z][^.:]*)\s*:\s*$') {
        $current = $matches[1].Trim()
    } elseif ($line -match 'IPv4 Address.*?:\s*(\d+\.\d+\.\d+\.\d+)\s*$') {
        $adapters += [pscustomobject]@{ Name = $current; IP = $matches[1] }
    }
}

$realLan = $adapters | Where-Object {
    $ip = $_.IP
    -not $ip.StartsWith('127.') -and
    -not $ip.StartsWith('169.254.') -and
    $_.Name -notmatch 'vEthernet|Loopback|Tunnel|Bluetooth|Hyper-V'
}

$chosen = $realLan | Where-Object { $_.Name -match 'Wi-?Fi' } | Select-Object -First 1
if (-not $chosen) { $chosen = $realLan | Select-Object -First 1 }

if (-not $chosen) {
    $blob = ($ipconfigLines | Out-String).Trim()
    Write-Error "Couldn't find a usable LAN IPv4. ipconfig output was:`n$blob"
    exit 2
}

Write-Host ""
Write-Host "Adapter : $($chosen.Name)" -ForegroundColor Cyan
Write-Host "IP      : $($chosen.IP)"   -ForegroundColor Green
Write-Host "URL     : http://$($chosen.IP):8000" -ForegroundColor Green
Write-Host ""
