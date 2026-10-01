# PostToolUse gate: every "## Description" written by the pipeline must fit in 80 % of the reference's space.
$ErrorActionPreference = 'Stop'

$Ratio = 0.8
# Approximate characters per line of the description column in the Avanade CV template.
$LineWidth = 70
$ReferenceRel = 'docs/cv-context/reference-too-long.md'
$Targets = '^experiences/(\.work/[^/]+/(0[12]-(structured|enriched)|03-update)|en/[^/]+|fr/[^/]+)\.md$'

try {
    . (Join-Path $PSScriptRoot 'cv-common.ps1')
    [Console]::OutputEncoding = [Text.Encoding]::UTF8
    $evt = Read-HookInput

    $checked = @()
    $violations = @()
    $budget = $null

    foreach ($value in (Get-PathValues $evt.tool_input)) {
        $rel = Resolve-CvPath $value
        if (-not $rel -or $rel -notmatch $Targets -or $checked -contains $rel) { continue }
        $file = Join-Path $CvRoot $rel
        if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { continue }
        $checked += $rel

        if (-not $budget) {
            $refFile = Join-Path $CvRoot $ReferenceRel
            if (-not (Test-Path -LiteralPath $refFile -PathType Leaf)) { throw "reference file missing: $ReferenceRel" }
            $ref = Get-CvDescriptionMetrics $refFile $LineWidth
            if (-not $ref) { throw "reference file has no '## Description' section: $ReferenceRel" }
            $budget = [pscustomobject]@{
                Chars = [int][Math]::Floor($ref.Chars * $Ratio)
                Lines = [int][Math]::Floor($ref.Lines * $Ratio)
            }
        }

        $m = Get-CvDescriptionMetrics $file $LineWidth
        if (-not $m) {
            $violations += "${rel}: missing '## Description' section."
            continue
        }
        if ($m.Chars -gt $budget.Chars -or $m.Lines -gt $budget.Lines) {
            $violations += "${rel}: $($m.Chars) chars / $($m.Lines) lines."
        }
    }

    if ($violations.Count -gt 0) {
        $out = @{
            decision = 'block'
            reason   = "Description over budget (max $($budget.Chars) chars and $($budget.Lines) lines of $LineWidth chars). " +
                       ($violations -join ' ') +
                       ' Shorten it: keep every fact and value signal, cut wording. One paragraph or bullet per line.'
        }
        [Console]::Out.Write(($out | ConvertTo-Json -Compress))
    }
    exit 0
}
catch {
    [Console]::Error.Write("cv-length: $($_.Exception.Message)")
    exit 2
}
