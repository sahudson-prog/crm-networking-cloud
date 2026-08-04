$ErrorActionPreference = "Stop"

$ProjectDir = Resolve-Path (Join-Path $PSScriptRoot "..")
$NextPath = Join-Path $ProjectDir ".next"
$CachePath = Join-Path $env:LOCALAPPDATA "CRMNetworking\next-cache"

if (Test-Path -LiteralPath $NextPath) {
    $item = Get-Item -LiteralPath $NextPath -Force
    $isReparsePoint = (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)

    if ($isReparsePoint) {
        [System.IO.Directory]::Delete($NextPath, $false)
    }
    else {
        $resolvedNext = Resolve-Path -LiteralPath $NextPath
        if (-not $resolvedNext.Path.StartsWith($ProjectDir.Path)) {
            throw "La ruta .next no esta dentro del proyecto: $($resolvedNext.Path)"
        }
        Remove-Item -LiteralPath $resolvedNext.Path -Recurse -Force
    }
}

if (Test-Path -LiteralPath $CachePath) {
    Remove-Item -LiteralPath $CachePath -Recurse -Force
}

New-Item -ItemType Directory -Path $CachePath -Force | Out-Null
New-Item -ItemType Junction -Path $NextPath -Target $CachePath | Out-Null
