function Resolve-PylonManagedAssembly {
    [CmdletBinding()]
    param(
        [string] $PylonAssemblyPath,
        [string] $PylonSdkRoot
    )

    $candidates = @()
    if (-not [string]::IsNullOrWhiteSpace($PylonAssemblyPath)) {
        $candidates += $PylonAssemblyPath
    } elseif (-not [string]::IsNullOrWhiteSpace($PylonSdkRoot)) {
        if (-not [System.IO.Path]::IsPathFullyQualified($PylonSdkRoot)) {
            throw 'PylonSdkRoot must be an absolute installed SDK path.'
        }
        $candidates += (Join-Path $PylonSdkRoot 'Development\Assemblies\Basler.Pylon\net8.0\x64\Basler.Pylon.dll')
        $candidates += (Join-Path $PylonSdkRoot 'Development\Assemblies\Basler.Pylon\x64\Basler.Pylon.dll')
        $candidates += (Join-Path $PylonSdkRoot 'Development\Assemblies\Basler.Pylon.dll')
    } else {
        $candidates += (Join-Path $env:ProgramFiles 'Basler\pylon\Development\Assemblies\Basler.Pylon\net8.0\x64\Basler.Pylon.dll')
        $candidates += (Join-Path $env:ProgramFiles 'Basler\pylon\Development\Assemblies\Basler.Pylon\x64\Basler.Pylon.dll')
        $candidates += (Join-Path $env:ProgramFiles 'Basler\pylon 8\Development\Assemblies\Basler.Pylon.dll')
        $candidates += (Join-Path $env:ProgramFiles 'Basler\pylon 7\Development\Assemblies\Basler.Pylon.dll')
        $candidates += (Join-Path $env:ProgramFiles 'Basler\pylon 6\Development\Assemblies\Basler.Pylon.dll')
    }

    $existing = @($candidates |
        Where-Object { -not [string]::IsNullOrWhiteSpace($_) -and (Test-Path -LiteralPath $_ -PathType Leaf) } |
        ForEach-Object { [System.IO.Path]::GetFullPath($_) } |
        Sort-Object -Unique)
    if ($existing.Count -ne 1) {
        throw 'Exactly one installed managed Basler.Pylon assembly must resolve; pass -PylonAssemblyPath explicitly when discovery is ambiguous.'
    }
    if (-not [System.IO.Path]::GetFileName($existing[0]).Equals('Basler.Pylon.dll', [System.StringComparison]::OrdinalIgnoreCase)) {
        throw 'The explicit Pylon managed dependency must be Basler.Pylon.dll.'
    }

    return $existing[0]
}
