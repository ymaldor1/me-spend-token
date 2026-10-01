#Requires -Version 5.1
# Non-interactive bridge between the Node launcher and McpAuth.psm1.
#   Export        -> JSON of every stored value for workspace + profile (stdout)
#   Import        -> reads a JSON object from stdin; null/"" deletes the key
#   SignAssertion -> RS256 client assertion JWT (stdout)
param(
    [Parameter(Mandatory)][ValidateSet('Export', 'Import', 'SignAssertion')][string]$Action,
    [string]$Workspace,
    [string]$ProfileName = 'default',
    [string]$Thumbprint,
    [string]$ClientId,
    [string]$Audience
)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'McpAuth.psm1') -Force

switch ($Action) {
    'Export' {
        [Console]::Out.Write((Get-McpProfile -Workspace $Workspace -ProfileName $ProfileName | ConvertTo-Json -Compress))
    }
    'Import' {
        $values = [Console]::In.ReadToEnd() | ConvertFrom-Json
        foreach ($prop in $values.PSObject.Properties) {
            Set-McpSecret -Workspace $Workspace -ProfileName $ProfileName -Key $prop.Name -Value ([string]$prop.Value)
        }
    }
    'SignAssertion' {
        [Console]::Out.Write((New-McpClientAssertion -Thumbprint $Thumbprint -ClientId $ClientId -Audience $Audience))
    }
}
