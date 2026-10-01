# Shared helpers for the cv-* hook scripts. Dot-source only.

$script:CvRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..')).TrimEnd('\')

function Read-HookInput {
    [Console]::InputEncoding = [Text.Encoding]::UTF8
    $raw = [Console]::In.ReadToEnd()
    if ([string]::IsNullOrWhiteSpace($raw)) { throw 'empty hook input' }
    return ($raw | ConvertFrom-Json)
}

function Get-PathValues($node) {
    $found = New-Object System.Collections.Generic.List[string]
    if ($null -eq $node -or $node -is [string]) { return ,$found }

    if ($node -is [System.Management.Automation.PSCustomObject]) {
        foreach ($prop in $node.PSObject.Properties) {
            if ($prop.Name -match '^(?i)(filePath|filePaths|path|paths|dirPath|uri)$') {
                foreach ($v in @($prop.Value)) { if ($v -is [string]) { $found.Add($v) } }
            }
            else {
                foreach ($v in (Get-PathValues $prop.Value)) { $found.Add($v) }
            }
        }
    }
    elseif ($node -is [System.Collections.IEnumerable]) {
        foreach ($item in $node) {
            foreach ($v in (Get-PathValues $item)) { $found.Add($v) }
        }
    }
    return ,$found
}

# Returns the workspace-relative path with '/' separators, or $null when outside the workspace.
function Resolve-CvPath([string]$value) {
    $p = $value.Trim()

    if ($p -match '^(?i)file://[^/]') { throw "UNC file URI not allowed: '$value'" }
    if ($p -match '^(?i)file:') { $p = [Uri]::UnescapeDataString(($p -replace '^(?i)file:/*', '')) }
    elseif ($p -match '^[a-zA-Z][a-zA-Z0-9+.\-]+:') { throw "unsupported URI scheme: '$value'" }

    if ($p -match '^[\\/]{2}') { throw "UNC path not allowed: '$value'" }
    if ($p -match '^[a-zA-Z]:(?![\\/])') { throw "drive-relative path not allowed: '$value'" }
    if ($p -notmatch '^(?:[a-zA-Z]:)?[^:*?"<>|]*$') { throw "invalid characters in path: '$value'" }

    if (-not [IO.Path]::IsPathRooted($p)) { $p = Join-Path $script:CvRoot $p }
    $full = [IO.Path]::GetFullPath($p).TrimEnd('\')

    if ($full -eq $script:CvRoot) { return '' }
    if (-not $full.StartsWith($script:CvRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { return $null }
    return $full.Substring($script:CvRoot.Length + 1).Replace('\', '/')
}

function Test-CvScope([string]$rel, [string[]]$prefixes) {
    $probe = $rel.TrimEnd('/') + '/'
    foreach ($pre in $prefixes) {
        if ($probe.StartsWith($pre, [StringComparison]::OrdinalIgnoreCase)) { return $true }
    }
    return $false
}

# Measures the "## Description" section as rendered in a CV column: characters and wrapped lines.
function Get-CvDescriptionMetrics([string]$file, [int]$lineWidth) {
    $text = [IO.File]::ReadAllText($file, [Text.Encoding]::UTF8) -replace "`r`n", "`n"
    $text = [regex]::Replace($text, '\A---\n[\s\S]*?\n---\n', '')
    $text = [regex]::Replace($text, '<!--[\s\S]*?-->', '')

    $m = [regex]::Match($text, '(?m)^##[ \t]+Description[ \t]*$([\s\S]*?)(?=^##[ \t]|\z)')
    if (-not $m.Success) { return $null }

    $chars = 0
    $lines = 0
    foreach ($raw in ($m.Groups[1].Value -split "`n")) {
        $line = $raw.Trim()
        if ($line -eq '') { continue }
        $line = $line -replace '^[*+]\s+', '- '
        $line = $line -replace '\[([^\]]*)\]\([^)]*\)', '$1'
        $line = $line -replace '(\*\*|__|`)', ''
        $line = $line -replace '\s+', ' '
        $chars += $line.Length
        $lines += [int][Math]::Ceiling($line.Length / $lineWidth)
    }
    return [pscustomobject]@{ Chars = $chars; Lines = $lines }
}
