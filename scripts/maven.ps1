param([Parameter(ValueFromRemainingArguments=$true)][string[]]$Goals=@('verify'))
$ErrorActionPreference='Stop'
$ProjectRoot=Split-Path $PSScriptRoot -Parent
$Tools=Join-Path $ProjectRoot '.runtime/tools'
$Maven=Join-Path $Tools 'apache-maven-3.9.11/bin/mvn.cmd'
if(!(Test-Path -LiteralPath $Maven)) {
 New-Item -ItemType Directory -Force -Path $Tools | Out-Null
 $Archive=Join-Path $Tools 'maven.zip'
 $Url='https://repo.maven.apache.org/maven2/org/apache/maven/apache-maven/3.9.11/apache-maven-3.9.11-bin.zip'
 Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $Archive
 $Expected=(Invoke-WebRequest -UseBasicParsing -Uri "$Url.sha512").Content.Trim().Split(' ')[0]
 $Hasher=[System.Security.Cryptography.SHA512]::Create()
 try { $Actual=([System.BitConverter]::ToString($Hasher.ComputeHash([System.IO.File]::ReadAllBytes($Archive)))).Replace('-','').ToLowerInvariant() } finally { $Hasher.Dispose() }
 if($Actual -ne $Expected.ToLowerInvariant()){throw 'Maven checksum mismatch'}
 Add-Type -AssemblyName System.IO.Compression.FileSystem
 [System.IO.Compression.ZipFile]::ExtractToDirectory($Archive,$Tools)
}
Push-Location $ProjectRoot
try { & $Maven "-Dmaven.repo.local=$ProjectRoot/.runtime/m2" @Goals; exit $LASTEXITCODE } finally { Pop-Location }
