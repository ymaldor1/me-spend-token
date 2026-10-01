#Requires -Version 5.1
# Windows Credential Manager storage + certificate client-assertion signing for the
# Power Platform MCP pack. Every value lives in a Generic credential named
# "PowerPlatformMCP:<workspace>:<profile>:<key>" (Control Panel > Credential Manager > Windows Credentials).
Set-StrictMode -Version Latest

$script:TargetPrefix = 'PowerPlatformMCP'
# CredentialBlob is capped at 2560 bytes (= 1280 UTF-16 chars); refresh tokens can exceed that.
$script:ChunkChars = 1200

$script:McpKeys = @(
    'TenantId', 'EnvironmentUrl', 'EnvironmentId', 'Username',
    'AppClientId', 'ClientSecret', 'CertThumbprint',
    'OAuthClientId', 'RefreshToken'
)

function Initialize-CredMan {
    if ('McpAuth.CredMan' -as [type]) { return }
    Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

namespace McpAuth {
    public static class CredMan {
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct CREDENTIAL {
            public int Flags;
            public int Type;
            public string TargetName;
            public string Comment;
            public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
            public int CredentialBlobSize;
            public IntPtr CredentialBlob;
            public int Persist;
            public int AttributeCount;
            public IntPtr Attributes;
            public string TargetAlias;
            public string UserName;
        }

        [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool CredRead(string target, int type, int flags, out IntPtr credential);

        [DllImport("advapi32.dll", EntryPoint = "CredWriteW", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool CredWrite(ref CREDENTIAL credential, int flags);

        [DllImport("advapi32.dll", EntryPoint = "CredDeleteW", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool CredDelete(string target, int type, int flags);

        [DllImport("advapi32.dll")]
        private static extern void CredFree(IntPtr buffer);

        private const int CRED_TYPE_GENERIC = 1;
        private const int CRED_PERSIST_LOCAL_MACHINE = 2;
        private const int ERROR_NOT_FOUND = 1168;

        public static string Read(string target, out string comment) {
            IntPtr ptr;
            comment = null;
            if (!CredRead(target, CRED_TYPE_GENERIC, 0, out ptr)) {
                int err = Marshal.GetLastWin32Error();
                if (err == ERROR_NOT_FOUND) return null;
                throw new Win32Exception(err);
            }
            try {
                CREDENTIAL cred = (CREDENTIAL)Marshal.PtrToStructure(ptr, typeof(CREDENTIAL));
                comment = cred.Comment;
                if (cred.CredentialBlobSize == 0 || cred.CredentialBlob == IntPtr.Zero) return "";
                return Marshal.PtrToStringUni(cred.CredentialBlob, cred.CredentialBlobSize / 2);
            } finally {
                CredFree(ptr);
            }
        }

        public static void Write(string target, string userName, string secret, string comment) {
            byte[] bytes = Encoding.Unicode.GetBytes(secret ?? "");
            CREDENTIAL cred = new CREDENTIAL();
            cred.Type = CRED_TYPE_GENERIC;
            cred.TargetName = target;
            cred.UserName = userName;
            cred.Comment = comment;
            cred.Persist = CRED_PERSIST_LOCAL_MACHINE;
            cred.CredentialBlobSize = bytes.Length;
            cred.CredentialBlob = Marshal.AllocHGlobal(Math.Max(bytes.Length, 1));
            try {
                Marshal.Copy(bytes, 0, cred.CredentialBlob, bytes.Length);
                if (!CredWrite(ref cred, 0)) throw new Win32Exception(Marshal.GetLastWin32Error());
            } finally {
                Marshal.Copy(new byte[bytes.Length], 0, cred.CredentialBlob, bytes.Length);
                Marshal.FreeHGlobal(cred.CredentialBlob);
                Array.Clear(bytes, 0, bytes.Length);
            }
        }

        public static bool Delete(string target) {
            if (CredDelete(target, CRED_TYPE_GENERIC, 0)) return true;
            int err = Marshal.GetLastWin32Error();
            if (err == ERROR_NOT_FOUND) return false;
            throw new Win32Exception(err);
        }
    }
}
'@
}

function Get-McpTarget([string]$Workspace, [string]$ProfileName, [string]$Key, [int]$Chunk = 0) {
    $base = "$($script:TargetPrefix):$($Workspace):$($ProfileName):$Key"
    if ($Chunk -gt 0) { return "$($base):$Chunk" }
    return $base
}

function Get-McpKeyNames { $script:McpKeys }

function Get-McpSecret {
    param([Parameter(Mandatory)][string]$Workspace, [Parameter(Mandatory)][string]$ProfileName, [Parameter(Mandatory)][string]$Key)
    Initialize-CredMan
    $comment = $null
    $first = [McpAuth.CredMan]::Read((Get-McpTarget $Workspace $ProfileName $Key), [ref]$comment)
    if ($null -eq $first) { return $null }
    $chunks = 1
    if ($comment -match '^chunks=(\d+)$') { $chunks = [int]$Matches[1] }
    if ($chunks -le 1) { return $first }
    $sb = [System.Text.StringBuilder]::new($first)
    for ($i = 1; $i -lt $chunks; $i++) {
        $ignored = $null
        $part = [McpAuth.CredMan]::Read((Get-McpTarget $Workspace $ProfileName $Key $i), [ref]$ignored)
        if ($null -eq $part) { throw "Credential '$Key' is corrupted (chunk $i of $chunks missing). Re-run the setup." }
        [void]$sb.Append($part)
    }
    return $sb.ToString()
}

function Remove-McpSecret {
    param([Parameter(Mandatory)][string]$Workspace, [Parameter(Mandatory)][string]$ProfileName, [Parameter(Mandatory)][string]$Key)
    Initialize-CredMan
    [void][McpAuth.CredMan]::Delete((Get-McpTarget $Workspace $ProfileName $Key))
    $i = 1
    while ([McpAuth.CredMan]::Delete((Get-McpTarget $Workspace $ProfileName $Key $i))) { $i++ }
}

function Set-McpSecret {
    param(
        [Parameter(Mandatory)][string]$Workspace,
        [Parameter(Mandatory)][string]$ProfileName,
        [Parameter(Mandatory)][string]$Key,
        [AllowEmptyString()][AllowNull()][string]$Value
    )
    if ($Key -notin $script:McpKeys) { throw "Unknown key '$Key'. Known keys: $($script:McpKeys -join ', ')" }
    Remove-McpSecret -Workspace $Workspace -ProfileName $ProfileName -Key $Key
    if ([string]::IsNullOrEmpty($Value)) { return }
    Initialize-CredMan
    $count = [Math]::Ceiling($Value.Length / $script:ChunkChars)
    for ($i = 0; $i -lt $count; $i++) {
        $start = $i * $script:ChunkChars
        $part = $Value.Substring($start, [Math]::Min($script:ChunkChars, $Value.Length - $start))
        $comment = if ($i -eq 0) { "chunks=$count" } else { "chunk $i of $Key" }
        [McpAuth.CredMan]::Write((Get-McpTarget $Workspace $ProfileName $Key $i), $Key, $part, $comment)
    }
}

function Get-McpProfile {
    param([Parameter(Mandatory)][string]$Workspace, [Parameter(Mandatory)][string]$ProfileName)
    $result = [ordered]@{}
    foreach ($key in $script:McpKeys) { $result[$key] = Get-McpSecret -Workspace $Workspace -ProfileName $ProfileName -Key $key }
    return $result
}

function Clear-McpProfile {
    param([Parameter(Mandatory)][string]$Workspace, [Parameter(Mandatory)][string]$ProfileName)
    foreach ($key in $script:McpKeys) { Remove-McpSecret -Workspace $Workspace -ProfileName $ProfileName -Key $key }
}

# Folder name reduced to characters that are safe in a credential target.
function ConvertTo-McpWorkspaceName([string]$Path) {
    (Split-Path $Path -Leaf) -replace '[^\w.-]', '_'
}

function ConvertTo-Base64Url([byte[]]$Bytes) {
    [Convert]::ToBase64String($Bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function Get-McpCertificate {
    param([Parameter(Mandatory)][string]$Thumbprint)
    $clean = ($Thumbprint -replace '[^0-9A-Fa-f]', '').ToUpperInvariant()
    foreach ($store in 'Cert:\CurrentUser\My', 'Cert:\LocalMachine\My') {
        $cert = Get-Item -LiteralPath (Join-Path $store $clean) -ErrorAction SilentlyContinue
        if ($cert) { return $cert }
    }
    return $null
}

# RS256 client assertion (https://learn.microsoft.com/entra/identity-platform/certificate-credentials).
# The private key is used in place from the certificate store and never exported.
function New-McpClientAssertion {
    param(
        [Parameter(Mandatory)][string]$Thumbprint,
        [Parameter(Mandatory)][string]$ClientId,
        [Parameter(Mandatory)][string]$Audience
    )
    $cert = Get-McpCertificate -Thumbprint $Thumbprint
    if (-not $cert) { throw "CERT_NOT_FOUND: certificate $Thumbprint not found in CurrentUser\My or LocalMachine\My." }
    if (-not $cert.HasPrivateKey) { throw "CERT_NO_KEY: certificate $Thumbprint has no private key on this machine." }
    $rsa = [System.Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPrivateKey($cert)
    if (-not $rsa) { throw "CERT_NO_KEY: certificate $Thumbprint does not carry an RSA private key." }

    $now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    $header = [ordered]@{ alg = 'RS256'; typ = 'JWT'; x5t = (ConvertTo-Base64Url $cert.GetCertHash()) } | ConvertTo-Json -Compress
    $payload = [ordered]@{
        aud = $Audience; iss = $ClientId; sub = $ClientId
        jti = [guid]::NewGuid().ToString(); nbf = $now - 60; iat = $now; exp = $now + 600
    } | ConvertTo-Json -Compress
    $unsigned = '{0}.{1}' -f (ConvertTo-Base64Url ([Text.Encoding]::UTF8.GetBytes($header))), (ConvertTo-Base64Url ([Text.Encoding]::UTF8.GetBytes($payload)))
    $signature = $rsa.SignData(
        [Text.Encoding]::UTF8.GetBytes($unsigned),
        [Security.Cryptography.HashAlgorithmName]::SHA256,
        [Security.Cryptography.RSASignaturePadding]::Pkcs1)
    return "$unsigned.$(ConvertTo-Base64Url $signature)"
}

Export-ModuleMember -Function Get-McpKeyNames, Get-McpSecret, Set-McpSecret, Remove-McpSecret, Get-McpProfile, Clear-McpProfile, ConvertTo-McpWorkspaceName, Get-McpCertificate, New-McpClientAssertion
