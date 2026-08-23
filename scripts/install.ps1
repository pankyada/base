param(
  [switch]$NoInit
)

$ErrorActionPreference = 'Stop'

$repo = 'pankyada/base'
$baseUrl = "https://github.com/$repo/releases/latest/download"
$userHome = [Environment]::GetFolderPath('UserProfile')
$installDir = Join-Path $env:LOCALAPPDATA 'Programs\harness'
$harnessDir = Join-Path $userHome '.harness'
$profileDir = Join-Path $harnessDir 'profiles'
$downloadDir = Join-Path $installDir 'downloads'

$architecture = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
if ($architecture -ne 'X64') {
  throw "Unsupported Windows architecture: $architecture"
}

New-Item -ItemType Directory -Force -Path $installDir, $harnessDir, $downloadDir | Out-Null

function Get-ReleaseAsset([string]$name, [string]$destination) {
  $headers = @{}
  $token = if ($env:GITHUB_TOKEN) { $env:GITHUB_TOKEN } elseif ($env:GH_TOKEN) { $env:GH_TOKEN } else { $null }
  if ($token) { $headers['Authorization'] = "token $token" }
  Write-Host "Downloading $name..."
  Invoke-WebRequest -UseBasicParsing -Headers $headers -Uri "$baseUrl/$name" -OutFile $destination
}

Get-ReleaseAsset 'harness-windows-x64.exe' (Join-Path $downloadDir 'harness.exe')
Get-ReleaseAsset 'harness-server-windows-x64.exe' (Join-Path $downloadDir 'harness-server.exe')
Get-ReleaseAsset 'harness-tui-windows-amd64.exe' (Join-Path $downloadDir 'harness-tui.exe')
$profilesArchive = Join-Path $downloadDir 'harness-profiles.tar.gz'
Get-ReleaseAsset 'harness-profiles.tar.gz' $profilesArchive

Move-Item -Force (Join-Path $downloadDir 'harness.exe') (Join-Path $installDir 'harness.exe')
Move-Item -Force (Join-Path $downloadDir 'harness-server.exe') (Join-Path $installDir 'harness-server.exe')
Move-Item -Force (Join-Path $downloadDir 'harness-tui.exe') (Join-Path $installDir 'harness-tui.exe')

$codingProfile = Join-Path $profileDir 'coding.yaml'
if (-not (Test-Path $codingProfile)) {
  tar -xzf $profilesArchive -C $harnessDir
  Write-Host "Installed default profiles to $profileDir"
} else {
  Write-Host "Keeping existing profiles in $profileDir"
}
Remove-Item -Force -Recurse $downloadDir

$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$pathParts = @($userPath -split ';' | Where-Object { $_ })
if (-not ($pathParts | Where-Object { $_ -ieq $installDir })) {
  $newPath = (($pathParts + $installDir) -join ';')
  [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
}
$env:Path = "$installDir;$env:Path"

Write-Host ""
Write-Host "Installed harness to $installDir"
Write-Host "Run 'harness init' to configure a profile, key, and surface."
& (Join-Path $installDir 'harness-server.exe') --version

if (-not $NoInit -and -not [Console]::IsInputRedirected) {
  & (Join-Path $installDir 'harness.exe') init
  exit $LASTEXITCODE
}
