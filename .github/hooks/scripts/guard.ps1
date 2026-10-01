# PreToolUse sandbox for the CV pipeline agents. Allowlist only; fails closed (exit 2) on any error.
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('orchestrator', 'wording', 'brain', 'translator', 'editor')]
    [string]$Role
)
$ErrorActionPreference = 'Stop'

$ToolKinds = @{
    agent = @('runSubagent', 'run_subagent', 'copilot_runSubagent')
    read  = @('read_file', 'readFile', 'copilot_readFile')
    list  = @('list_dir', 'listDirectory', 'copilot_listDirectory')
    create = @(
        'create_file', 'createFile', 'copilot_createFile',
        'create_directory', 'createDirectory', 'copilot_createDirectory'
    )
    modify = @(
        'replace_string_in_file', 'replaceString', 'copilot_replaceString',
        'multi_replace_string_in_file', 'multiReplaceString', 'copilot_multiReplaceString'
    )
}

$AllowedAgents = @('cv-wording', 'cv-brain-extractor', 'cv-translator', 'cv-editor')

$Context = 'docs/cv-context/'
$Skill = '.github/skills/cv-style-guide/'
$Work = 'experiences/.work/'
$En = 'experiences/en/'
$Fr = 'experiences/fr/'
$Inbox = 'experiences/inbox/'

$Policies = @{
    orchestrator = @{ Kinds = @('agent'); Read = @(); Write = @() }
    wording      = @{ Kinds = @('read', 'list', 'create', 'modify'); Read = @($Context, $Skill, $Inbox, $En, $Fr); Write = @($Work) }
    brain        = @{ Kinds = @('read', 'create', 'modify'); Read = @($Context, $Skill, $En, $Fr); Write = @($Work) }
    translator   = @{ Kinds = @('read', 'create', 'modify'); Read = @($Context, $Skill, $Work); Write = @($En, $Fr) }
    # No 'create': the editor may only change existing files in place.
    editor       = @{ Kinds = @('read', 'modify'); Read = @($Context, $Skill, $Work); Write = @($En, $Fr) }
}

function Stop-Deny([string]$reason) {
    $out = @{
        hookSpecificOutput = @{
            hookEventName            = 'PreToolUse'
            permissionDecision       = 'deny'
            permissionDecisionReason = "cv-guard[$Role]: $reason"
        }
    }
    [Console]::Out.Write(($out | ConvertTo-Json -Compress -Depth 4))
    exit 0
}

try {
    . (Join-Path $PSScriptRoot 'cv-common.ps1')
    $evt = Read-HookInput
    $tool = [string]$evt.tool_name
    $policy = $Policies[$Role]

    $kind = $null
    foreach ($k in $ToolKinds.Keys) {
        if ($ToolKinds[$k] -contains $tool) { $kind = $k; break }
    }
    if (-not $kind -or $policy.Kinds -notcontains $kind) {
        Stop-Deny "tool '$tool' is not allowed for this agent."
    }

    if ($kind -eq 'agent') {
        $target = [string]$evt.tool_input.agentName
        if ($AllowedAgents -notcontains $target) {
            Stop-Deny "subagent '$target' is not part of the CV pipeline. Allowed: $($AllowedAgents -join ', ')."
        }
        exit 0
    }

    $paths = Get-PathValues $evt.tool_input
    if ($paths.Count -eq 0) { Stop-Deny "no file path found in '$tool' input." }

    $scope = if ($kind -in 'create', 'modify') { $policy.Write } else { @($policy.Read) + @($policy.Write) }
    foreach ($value in $paths) {
        try { $rel = Resolve-CvPath $value } catch { Stop-Deny $_.Exception.Message }
        if ($null -eq $rel) { Stop-Deny "'$value' is outside the workspace." }
        if (-not (Test-CvScope $rel $scope)) {
            Stop-Deny "$kind access to '$rel' is outside this agent's scope ($($scope -join ', '))."
        }
    }
    exit 0
}
catch {
    [Console]::Error.Write("cv-guard[$Role]: blocked, $($_.Exception.Message)")
    exit 2
}
