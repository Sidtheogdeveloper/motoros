$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
$sender = Read-Host 'Gmail sending address'
$credential = Read-Host 'Google App Password (hidden; not your Google password)' -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($credential)
try {
    # Process-local environment avoids secrets in command arguments and shell history.
    $env:MOTOROS_SETUP_GMAIL_ADDRESS = $sender
    $env:MOTOROS_SETUP_GMAIL_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    node scripts/configure-gmail.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Gmail setup did not complete.' }
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    Remove-Item Env:MOTOROS_SETUP_GMAIL_ADDRESS -ErrorAction SilentlyContinue
    Remove-Item Env:MOTOROS_SETUP_GMAIL_PASSWORD -ErrorAction SilentlyContinue
    $credential.Dispose()
}
