#Requires -Version 5.1
<#
.SYNOPSIS
    Interactive auth setup for the Power Platform MCP pack (power-platform, power-automate,
    canvas-authoring). Stores every value in Windows Credential Manager under
    "PowerPlatformMCP:<workspace>:<profile>:<key>" and the chosen mode/profile in <workspace>\.vscode\mcp\auth.config.json.

.DESCRIPTION
    Modes:
      secret  app-only, Entra app registration + client secret
      cert    app-only, Entra app registration + certificate (private key stays in the Windows cert store)
      oauth   delegated, signs in as you in the browser (refresh token kept in Credential Manager)
    canvas-authoring always signs in as a user (the server has no app-only auth), whatever the mode.

.EXAMPLE
    pwsh -File .vscode/mcp/auth/Setup-McpAuth.ps1
    pwsh -File .vscode/mcp/auth/Setup-McpAuth.ps1 -Mode cert -ProfileName cnav-dev
    pwsh -File .vscode/mcp/auth/Setup-McpAuth.ps1 -Reset    # delete this workspace's stored values, then set up again
#>
param(
    [ValidateSet('secret', 'cert', 'oauth')][string]$Mode,
    [string]$ProfileName,
    [string]$Server = 'all',
    [string]$Missing,
    [string]$Reason,
    [switch]$FromLauncher,
    [switch]$SkipTest,
    [string]$WorkspaceRoot,
    [switch]$Reset
)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'McpAuth.psm1') -Force

$mcpRoot = Split-Path $PSScriptRoot -Parent
if (-not $WorkspaceRoot) {
    $packParent = Split-Path $mcpRoot -Parent
    $WorkspaceRoot = if ((Split-Path $packParent -Leaf) -eq '.vscode') { Split-Path $packParent -Parent } else { (Get-Location).Path }
}
$configPath = Join-Path $WorkspaceRoot '.vscode\mcp\auth.config.json'
$savedConfig = if (Test-Path $configPath) { Get-Content $configPath -Raw | ConvertFrom-Json } else { $null }
$WorkspaceName = if ($savedConfig -and $savedConfig.PSObject.Properties['workspace'] -and $savedConfig.workspace) { $savedConfig.workspace } else { ConvertTo-McpWorkspaceName $WorkspaceRoot }
$defaultOAuthClientId = '9cee029c-6210-4654-90bb-17e6e9d36617'
$knownOAuthApps = [ordered]@{
    '9cee029c-6210-4654-90bb-17e6e9d36617' = 'Power Platform CLI (pac) - Microsoft app, used by "pac auth create"'
    '04b07795-8ddb-461a-bbee-02f9e1bf7b46' = 'Azure CLI - Microsoft app, often blocked by Conditional Access'
}
$guidPattern = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'

function Write-Title([string]$Text) {
    Write-Host ''
    Write-Host "== $Text" -ForegroundColor Cyan
}

function Write-Guide([string[]]$Lines) {
    foreach ($line in $Lines) { Write-Host "   $line" -ForegroundColor DarkGray }
}

# Prompts until a valid value is given. Enter keeps the stored value (or takes the default).
# $Normalize receives the raw input, returns the value to store, or throws with a message.
function Read-Value {
    param(
        [string]$Label,
        [string]$Current,
        [string]$Default,
        [string]$Hint,
        [switch]$Secret,
        [scriptblock]$Normalize
    )
    if ($Hint) { Write-Guide $Hint }
    while ($true) {
        $state = if ($Current) { if ($Secret) { 'stored, Enter keeps it' } else { "$Current, Enter keeps it" } } elseif ($Default) { "default $Default" } else { $null }
        $prompt = if ($state) { "$Label [$state]" } else { $Label }
        if ($Secret) {
            $secure = Read-Host -Prompt $prompt -AsSecureString
            $raw = [Net.NetworkCredential]::new('', $secure).Password
        } else {
            $raw = Read-Host -Prompt $prompt
        }
        $raw = "$raw".Trim()
        if (-not $raw) {
            if ($Current) { return $Current }
            $raw = $Default
        }
        if (-not $raw) { Write-Host '   A value is required.' -ForegroundColor Yellow; continue }
        try {
            if ($Normalize) { return (& $Normalize $raw) }
            return $raw
        } catch {
            Write-Host "   $($_.Exception.Message)" -ForegroundColor Yellow
        }
    }
}

$normalizeGuid = { param($v) if ($v -notmatch $guidPattern) { throw 'Expected a GUID (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx).' }; $v.ToLowerInvariant() }

$normalizeTenant = {
    param($v)
    if ($v -match $guidPattern) { return $v.ToLowerInvariant() }
    $meta = Invoke-RestMethod "https://login.microsoftonline.com/$v/v2.0/.well-known/openid-configuration"
    if ($meta.issuer -match '/([0-9a-f-]{36})/') {
        Write-Host "   -> $v resolves to tenant $($Matches[1])" -ForegroundColor DarkGray
        return $Matches[1]
    }
    throw "Could not resolve tenant '$v'."
}

$normalizeEnvUrl = {
    param($v)
    if ($v -notmatch '^https?://') { $v = "https://$v" }
    $v = $v.TrimEnd('/')
    if ($v -notmatch '^https://[a-z0-9-]+\.crm\d*\.dynamics\.com$') { throw 'Expected https://<org>.crm<N>.dynamics.com' }
    $v.ToLowerInvariant()
}

$normalizeEnvId = {
    param($v)
    if ($v -notmatch '^(Default-)?[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') {
        throw 'Expected an environment id: a GUID, or Default-<tenant GUID> for the default environment.'
    }
    $v
}

$normalizeUpn = { param($v) if ($v -notmatch '^[^@\s]+@[^@\s]+\.[^@\s]+$') { throw 'Expected a user principal name, e.g. first.last@contoso.com' }; $v.ToLowerInvariant() }

function Show-AppRegistrationGuide([string]$CredentialStep) {
    Write-Guide @(
        'App registration (once per tenant, needs an Entra admin or Application Developer role):'
        ' 1. entra.microsoft.com > Identity > Applications > App registrations > New registration'
        '    Name e.g. "PowerPlatform-MCP", single tenant, no redirect URI. Copy the Application (client) ID.'
        $CredentialStep
        ' 3. Dataverse (power-platform MCP + Dataverse tools of power-automate):'
        '    admin.powerplatform.microsoft.com > Environments > <env> > Settings > Users + permissions >'
        '    Application users > New app user > pick the app, business unit and a security role'
        '    (System Customizer for solution work, System Administrator for full access).'
        ' 4. Power Automate: an app only sees flows it owns or that are shared with its application user.'
        '    Flow-management endpoints (api.flow.microsoft.com) have limited service-principal support;'
        '    the access test at the end reports exactly what this app can reach.'
        ' 5. canvas-authoring cannot run app-only: it signs in as the user entered below (browser/WAM).'
    )
}

function Show-Guide([string]$SelectedMode) {
    Write-Title "Guide: $SelectedMode"
    switch ($SelectedMode) {
        'secret' {
            Show-AppRegistrationGuide ' 2. Certificates & secrets > Client secrets > New client secret. Copy the VALUE (shown once), not the Secret ID.'
        }
        'cert' {
            Show-AppRegistrationGuide ' 2. Certificates & secrets > Certificates > Upload certificate: the .cer produced/exported by this setup.'
            Write-Guide @(
                'Certificate: pick one already in Cert:\CurrentUser\My (with private key), import a .pfx,'
                'or let this setup create a self-signed one (non-exportable key, 2 years) and export its public .cer.'
            )
        }
        'oauth' {
            Write-Guide @(
                'Delegated sign-in with your own account (authorization code + PKCE in the browser).'
                'Sign-in goes through an Entra "public client" app. Default: the Power Platform CLI (pac) app -'
                'if "pac auth create" works for you, this works too. No app registration needed.'
                'Which app is allowed depends on your tenant''s Conditional Access: if sign-in fails, the setup'
                'lets you try another app. You can see your own attempts (app, result) at https://mysignins.microsoft.com'
                'Own public client (most robust, needs an Entra admin):'
                ' - App registrations > New registration > Authentication > Add a platform >'
                '   "Mobile and desktop applications" > redirect URI http://localhost ; Allow public client flows = Yes'
                ' - API permissions (delegated): Dynamics CRM user_impersonation, Power Automate (Flow Service) User,'
                '   PowerApps Service User, Power Platform API; then Grant admin consent.'
                'The refresh token is stored in Credential Manager and rotated automatically.'
            )
        }
    }
}

function Read-Choice([string]$Prompt, [string[]]$Allowed, [string]$Default) {
    while ($true) {
        $choice = "$(Read-Host $Prompt)".Trim().ToUpperInvariant()
        if (-not $choice -and $Default) { return $Default }
        if ($choice -in $Allowed) { return $choice }
        Write-Host "   Choose one of: $($Allowed -join ', ')" -ForegroundColor Yellow
    }
}

function Select-OAuthApp([string]$Current) {
    Write-Host ''
    Write-Host '   Sign-in app:'
    $ids = @($knownOAuthApps.Keys)
    for ($i = 0; $i -lt $ids.Count; $i++) {
        $mark = if ($ids[$i] -eq $Current) { ' (current)' } else { '' }
        Write-Host ('   [{0}] {1}{2}' -f ($i + 1), $knownOAuthApps[$ids[$i]], $mark)
    }
    Write-Host '   [O] your own app registration (enter its Application ID)'
    $allowed = @(1..$ids.Count | ForEach-Object { "$_" }) + 'O'
    $choice = Read-Choice "   Choice [Enter keeps $Current]" $allowed 'KEEP'
    if ($choice -eq 'KEEP') { return $Current }
    if ($choice -eq 'O') { return (Read-Value '   Application (client) ID' -Normalize $normalizeGuid) }
    return $ids[[int]$choice - 1]
}

# Loops until sign-in succeeds; the user can retry, switch app, change mode or quit.
function Invoke-OAuthSignIn([string]$TenantId, [string]$ClientId, [string]$Username) {
    $loginScript = Join-Path $mcpRoot 'core\oauth-login.mjs'
    while ($true) {
        $output = & node $loginScript --tenant $TenantId --client $ClientId --login-hint $Username
        if ($LASTEXITCODE -eq 0) {
            $login = (-join $output) | ConvertFrom-Json
            $login | Add-Member -NotePropertyName clientId -NotePropertyValue $ClientId
            return $login
        }
        Write-Host ''
        Write-Host 'Sign-in did not complete.' -ForegroundColor Yellow
        Write-Guide @('[R] retry with the same app', '[A] try another sign-in app', '[M] choose another auth mode', '[Q] quit setup')
        switch (Read-Choice 'Choice [R]' @('R', 'A', 'M', 'Q') 'R') {
            'A' { $ClientId = Select-OAuthApp $ClientId }
            'M' { throw 'MCP_SETUP:CHANGE_MODE' }
            'Q' { throw 'MCP_SETUP:QUIT' }
        }
    }
}

function Get-ExportFolder {
    $downloads = Join-Path $HOME 'Downloads'
    if (Test-Path $downloads) { return $downloads }
    return $env:TEMP
}

function Select-Certificate([string]$Current, [string]$Name) {
    $now = Get-Date
    $certs = @(Get-ChildItem Cert:\CurrentUser\My | Where-Object { $_.HasPrivateKey -and $_.NotAfter -gt $now } | Sort-Object NotAfter -Descending)
    Write-Host ''
    Write-Host '   Certificates with a private key in Cert:\CurrentUser\My:'
    for ($i = 0; $i -lt $certs.Count; $i++) {
        $c = $certs[$i]
        $mark = if ($c.Thumbprint -eq $Current) { ' (current)' } else { '' }
        Write-Host ('   [{0}] {1}  {2}  expires {3:yyyy-MM-dd}{4}' -f ($i + 1), $c.Subject, $c.Thumbprint, $c.NotAfter, $mark)
    }
    Write-Host '   [N] create a new self-signed certificate'
    Write-Host '   [P] import a .pfx file'
    while ($true) {
        $hint = if ($Current) { " [Enter keeps $Current]" } else { '' }
        $choice = "$(Read-Host "   Choice$hint")".Trim()
        if (-not $choice -and $Current) {
            if (Get-McpCertificate -Thumbprint $Current) { return $Current }
            Write-Host "   Stored certificate $Current is not on this machine any more." -ForegroundColor Yellow
            continue
        }
        if ($choice -match '^\d+$' -and [int]$choice -ge 1 -and [int]$choice -le $certs.Count) {
            return $certs[[int]$choice - 1].Thumbprint
        }
        if ($choice -match '^[Nn]$') {
            $cert = New-SelfSignedCertificate -Subject "CN=PowerPlatformMCP-$Name" -CertStoreLocation Cert:\CurrentUser\My `
                -KeyExportPolicy NonExportable -KeyUsage DigitalSignature -KeyAlgorithm RSA -KeyLength 2048 `
                -HashAlgorithm SHA256 -Provider 'Microsoft Software Key Storage Provider' -NotAfter (Get-Date).AddYears(2)
            $cerPath = Join-Path (Get-ExportFolder) "PowerPlatformMCP-$Name.cer"
            Export-Certificate -Cert $cert -FilePath $cerPath -Type CERT | Out-Null
            Write-Host "   Created $($cert.Thumbprint); public key exported to $cerPath" -ForegroundColor Green
            Write-Guide @(
                'Upload it now: App registrations > <your app> > Certificates & secrets > Certificates > Upload certificate.'
                'The private key never leaves this machine''s certificate store (non-exportable).'
            )
            [void](Read-Host '   Press Enter once the certificate is uploaded')
            return $cert.Thumbprint
        }
        if ($choice -match '^[Pp]$') {
            $pfx = "$(Read-Host '   Path to .pfx')".Trim('"', ' ')
            if (-not (Test-Path -LiteralPath $pfx)) { Write-Host '   File not found.' -ForegroundColor Yellow; continue }
            $password = Read-Host '   PFX password' -AsSecureString
            $imported = Import-PfxCertificate -FilePath $pfx -CertStoreLocation Cert:\CurrentUser\My -Password $password
            $imported = @($imported | Where-Object HasPrivateKey)[0]
            if (-not $imported) { Write-Host '   The .pfx has no private key.' -ForegroundColor Yellow; continue }
            Write-Host "   Imported $($imported.Thumbprint)" -ForegroundColor Green
            return $imported.Thumbprint
        }
        Write-Host '   Invalid choice.' -ForegroundColor Yellow
    }
}

# --- wizard -----------------------------------------------------------------------------------
function Save-Values([System.Collections.IDictionary]$Values) {
    foreach ($key in $Values.Keys) { Set-McpSecret -Workspace $WorkspaceName -ProfileName $ProfileName -Key $key -Value $Values[$key] }
}

function Invoke-Wizard([string]$Mode) {
$config = if (Test-Path $configPath) { Get-Content $configPath -Raw | ConvertFrom-Json } else { [pscustomobject]@{ mode = 'oauth'; profile = 'default' } }

if (-not $Mode) {
    Write-Title 'Auth mode'
    Write-Guide @(
        '[1] secret  app-only: app registration + client secret'
        '[2] cert    app-only: app registration + certificate'
        '[3] oauth   delegated: sign in with your account'
    )
    $map = @{ '1' = 'secret'; '2' = 'cert'; '3' = 'oauth'; 'secret' = 'secret'; 'cert' = 'cert'; 'oauth' = 'oauth' }
    while (-not $Mode) {
        $choice = "$(Read-Host "Mode [Enter keeps $($config.mode)]")".Trim().ToLowerInvariant()
        if (-not $choice) { $choice = $config.mode }
        $Mode = $map[$choice]
        if (-not $Mode) { Write-Host '   Choose 1, 2 or 3.' -ForegroundColor Yellow }
    }
}

Show-Guide $Mode
$stored = Get-McpProfile -Workspace $WorkspaceName -ProfileName $ProfileName
$new = [ordered]@{}

# --- values shared by every mode --------------------------------------------------------------
Write-Title 'Tenant & environment'
$new.TenantId = Read-Value 'Tenant (GUID or domain)' $stored.TenantId -Normalize $normalizeTenant `
    -Hint 'Entra admin center > Overview > Tenant ID, or a verified domain such as contoso.onmicrosoft.com.'
$new.EnvironmentUrl = Read-Value 'Dataverse environment URL' $stored.EnvironmentUrl -Normalize $normalizeEnvUrl `
    -Hint 'make.powerapps.com > gear icon > Session details > Instance url (https://<org>.crm<N>.dynamics.com).'
$new.EnvironmentId = Read-Value 'Environment ID' $stored.EnvironmentId -Normalize $normalizeEnvId `
    -Hint 'Same Session details panel > Environment ID (GUID, or Default-<tenant GUID>).'
$new.Username = Read-Value 'Your user (UPN)' $stored.Username -Normalize $normalizeUpn `
    -Hint 'Used as OAuth login hint and for canvas-authoring sign-in (always delegated).'
Save-Values $new

# --- mode-specific values ---------------------------------------------------------------------
Write-Title "Credentials ($Mode)"
switch ($Mode) {
    'secret' {
        $new.AppClientId = Read-Value 'Application (client) ID' $stored.AppClientId -Normalize $normalizeGuid
        $new.ClientSecret = Read-Value 'Client secret value' $stored.ClientSecret -Secret `
            -Hint 'Input is hidden. Note the secret expiry date: re-run this setup when it is rotated.'
    }
    'cert' {
        $new.AppClientId = Read-Value 'Application (client) ID' $stored.AppClientId -Normalize $normalizeGuid
        $new.CertThumbprint = Select-Certificate $stored.CertThumbprint $ProfileName
    }
    'oauth' {
        $current = if ($stored.OAuthClientId) { $stored.OAuthClientId } else { $defaultOAuthClientId }
        $label = if ($knownOAuthApps.Contains($current)) { $knownOAuthApps[$current] } else { "your own app $current" }
        Write-Guide "Sign-in app: $label"
        $new.OAuthClientId = $current
        if ("$(Read-Host 'Use a different sign-in app? [y/N]')" -match '^[Yy]') { $new.OAuthClientId = Select-OAuthApp $current }
        $signIn = -not $stored.RefreshToken -or $stored.OAuthClientId -ne $new.OAuthClientId -or $stored.TenantId -ne $new.TenantId -or
            ("$(Read-Host 'A refresh token is stored. Sign in again? [y/N]')" -match '^[Yy]')
        if ($signIn) {
            $login = Invoke-OAuthSignIn $new.TenantId $new.OAuthClientId $new.Username
            $new.OAuthClientId = $login.clientId
            $new.RefreshToken = $login.refreshToken
            if ($login.username -and $login.username -ne $new.Username) {
                Write-Host "   Signed in as $($login.username) (not $($new.Username)); storing $($login.username) as your user." -ForegroundColor Yellow
                $new.Username = $login.username.ToLowerInvariant()
            }
        }
    }
}

# --- persist ----------------------------------------------------------------------------------
Save-Values $new
# Rewriting this file also restarts every server that watches it (dev.watch in mcp.json).
$json = [ordered]@{ mode = $Mode; profile = $ProfileName; workspace = $WorkspaceName } | ConvertTo-Json
[void](New-Item -ItemType Directory -Force (Split-Path $configPath))
[IO.File]::WriteAllText($configPath, "$json`n", [Text.UTF8Encoding]::new($false))
Write-Host ''
Write-Host "Saved: mode '$Mode', profile '$ProfileName' ($configPath) + $($new.Count) value(s) in Credential Manager." -ForegroundColor Green

if (-not $SkipTest -and ("$(Read-Host 'Run the access test now? [Y/n]')" -notmatch '^[Nn]')) {
    $env:PP_MCP_NO_SETUP = '1'
    $env:PP_MCP_WORKSPACE = $WorkspaceRoot
    & node (Join-Path $mcpRoot 'launch.mjs') --test $Server
    $testFailed = $LASTEXITCODE -ne 0
    Remove-Item Env:PP_MCP_NO_SETUP, Env:PP_MCP_WORKSPACE
    if ($testFailed) {
        Write-Host ''
        Write-Host 'Some access checks failed (see FAIL lines above).' -ForegroundColor Yellow
        Write-Guide @('[K] keep this setup anyway', '[R] redo the setup (e.g. another sign-in app)', '[M] choose another auth mode')
        switch (Read-Choice 'Choice [K]' @('K', 'R', 'M') 'K') {
            'R' { throw 'MCP_SETUP:RETRY' }
            'M' { throw 'MCP_SETUP:CHANGE_MODE' }
        }
    }
}
}

# --- main: the wizard never just dies; every failure offers a way forward --------------------
if (-not $ProfileName) {
    $ProfileName = if ($savedConfig -and $savedConfig.profile) { $savedConfig.profile } else { 'default' }
}

Write-Host 'Power Platform MCP - auth setup' -ForegroundColor Cyan
Write-Host "Workspace '$WorkspaceName' ($WorkspaceRoot), profile '$ProfileName'"
Write-Host "Values are stored in Windows Credential Manager as PowerPlatformMCP:$($WorkspaceName):$($ProfileName):*"
if ($FromLauncher) {
    Write-Host ''
    Write-Host "The '$Server' MCP server cannot start yet." -ForegroundColor Yellow
    if ($Missing) { Write-Host "  Missing: $Missing" -ForegroundColor Yellow }
    if ($Reason) { Write-Host "  $Reason" -ForegroundColor Yellow }
}

if ($Reset) {
    Write-Host ''
    if ("$(Read-Host "Delete every stored value of '$WorkspaceName' / '$ProfileName' and set up from scratch? [y/N]")" -match '^[Yy]') {
        Clear-McpProfile -Workspace $WorkspaceName -ProfileName $ProfileName
        Write-Host 'Stored values deleted.' -ForegroundColor Green
    } else {
        Write-Host 'Nothing deleted; stored values will be offered as defaults.' -ForegroundColor DarkGray
    }
}

$completed = $false
# Separate from the [ValidateSet] -Mode parameter, which refuses $null.
$wizardMode = $Mode
:wizard while ($true) {
    try {
        Invoke-Wizard $wizardMode
        $completed = $true
        break wizard
    } catch {
        switch ($_.Exception.Message) {
            'MCP_SETUP:QUIT' { break wizard }
            'MCP_SETUP:RETRY' { continue wizard }
            'MCP_SETUP:CHANGE_MODE' { $wizardMode = $null; continue wizard }
        }
        Write-Host ''
        Write-Host "Setup step failed: $($_.Exception.Message)" -ForegroundColor Red
        Write-Guide @('Values entered so far are saved; Enter keeps them on retry.', '[R] retry', '[M] choose another auth mode', '[Q] quit setup')
        switch (Read-Choice 'Choice [R]' @('R', 'M', 'Q') 'R') {
            'M' { $wizardMode = $null }
            'Q' { break wizard }
        }
    }
}

if ($FromLauncher) {
    if ($completed) {
        [void](Read-Host "`nPress Enter to close this window and let the '$Server' MCP server start")
    } else {
        Write-Host "`nSetup not completed. The '$Server' MCP server will start without its tools and explain in chat how to finish (auth_setup tool)." -ForegroundColor Yellow
        [void](Read-Host 'Press Enter to close this window')
    }
}
if (-not $completed) { exit 1 }
