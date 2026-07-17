# scripts/set-dev-api-url.ps1
#
# Rewrites EXPO_PUBLIC_API_URL in client/.env to match the dev machine's
# current LAN IPv4. Expo device builds cannot resolve `localhost` from the
# phone, so the URL must be the Wi-Fi IP. Every time you switch Wi-Fi the
# IP changes, hence this script.
#
# Usage:
#   pwsh ./scripts/set-dev-api-url.ps1
#   npm run dev:api-url
#
# What it does:
#   1. Picks the first non-virtual, non-link-local IPv4 from `ipconfig`.
#      Prefers adapters named "Wi-Fi" or "WiFi"; falls back to any
#      physical adapter if none match.
#   2. Rewrites the EXPO_PUBLIC_API_URL=... line in .env.
#   3. Reports the old and new URLs.
#
# Why PowerShell and not Node: `ipconfig` parsing is the bulk of the work
# and PowerShell already does regex against the multiline output cleanly.
# Keep this script as the Windows entrypoint. A Node/bash version can be
# added later if anyone runs the dev setup off-Windows.

$ErrorActionPreference = 'Stop'

# Resolve the client root (this script lives in client/scripts/).
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ClientDir = Split-Path -Parent $ScriptDir
$EnvFile = Join-Path $ClientDir '.env'

if (-not (Test-Path $EnvFile)) {
    Write-Error ".env not found at $EnvFile. Create it from .env.example first."
    exit 1
}

# Pull all IPv4 addresses from ipconfig with their adapter names.
# Piping `ipconfig` directly into the loop (instead of capturing to a
# variable) keeps each output line as a distinct iteration item. When
# PowerShell captures native output into `$x = ipconfig`, it collapses to
# a one-element collection and the loop would see the whole blob as one
# line. Streaming avoids that.
$adapters = @()
$current = $null
$ipconfigLines = ipconfig
foreach ($line in $ipconfigLines) {
    # Adapter heading lines look like "   Wireless LAN adapter Wi-Fi:" or
    # "   Ethernet adapter Ethernet:". They end with a single colon and the
    # body is short. Anchor with the colon-at-end-of-line shape and require
    # the body to not start with a dot — that filters out the dotted-leader
    # lines like "   IPv4 Address. . . . . . . . . . . : 10.x.x.x" which
    # also end in a colon but are values, not section headings.
    if ($line -match '^\s*([A-Za-z][^.:]*)\s*:\s*$') {
        $current = $matches[1].Trim()
    } elseif ($line -match 'IPv4 Address.*?:\s*(\d+\.\d+\.\d+\.\d+)\s*$') {
        # `ipconfig` formats IPv4 lines with dotted leaders (`. . . . . .`)
        # between the label and the value, so we just anchor on the colon +
        # trailing IPv4 rather than trying to match the leader literally.
        $ip = $matches[1]
        $adapters += [pscustomobject]@{ Name = $current; IP = $ip }
    }
}

# Filter out things that aren't real LAN IPs: loopback (127.x), link-local
# (169.254.x), virtual switches (172.x is fine on most LANs but the vEthernet
# adapters from Hyper-V/WSL are not routable from a phone).
$realLan = $adapters | Where-Object {
    $ip = $_.IP
    -not $ip.StartsWith('127.') -and
    -not $ip.StartsWith('169.254.') -and
    $_.Name -notmatch 'vEthernet|Loopback|Tunnel|Bluetooth|Hyper-V'
}

# Prefer the Wi-Fi adapter explicitly. If absent (wired desktop), take any.
$chosen = $realLan | Where-Object { $_.Name -match 'Wi-?Fi' } | Select-Object -First 1
if (-not $chosen) {
    $chosen = $realLan | Select-Object -First 1
}

if (-not $chosen) {
    $blob = ($ipconfigLines | Out-String).Trim()
    Write-Error "Couldn't find a usable LAN IPv4. ipconfig output was:`n$blob"
    exit 2
}

$newIp = $chosen.IP
$newUrl = "http://${newIp}:8000"

# Read the current EXPO_PUBLIC_API_URL value so we can show the diff.
$lines = Get-Content $EnvFile
$currentUrl = ($lines | Where-Object { $_ -match '^EXPO_PUBLIC_API_URL\s*=' } | Select-Object -First 1) `
    -replace '^EXPO_PUBLIC_API_URL\s*=\s*', ''

# Rewrite the URL line in place; preserve everything else (incl. comments).
$updated = $lines | ForEach-Object {
    if ($_ -match '^EXPO_PUBLIC_API_URL\s*=') {
        "EXPO_PUBLIC_API_URL=$newUrl"
    } else {
        $_
    }
}

Set-Content -Path $EnvFile -Value $updated -Encoding utf8

Write-Host ""
Write-Host "Network adapter : $($chosen.Name)" -ForegroundColor Cyan
Write-Host "Old URL         : $currentUrl"
Write-Host "New URL         : $newUrl" -ForegroundColor Green
Write-Host ""
Write-Host "Restart Metro (npm run start) so the new value is picked up." -ForegroundColor Yellow