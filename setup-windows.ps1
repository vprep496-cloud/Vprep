param(
  [switch]$InstallPrerequisites,
  [switch]$SkipModelPull,
  [switch]$SkipPipInstall,
  [switch]$SkipNpmInstall,
  [switch]$SeedDemoData
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Backend = Join-Path $Root "backend"
$Admin = Join-Path $Root "admin"
$Mobile = Join-Path $Root "mobile"

function Write-Step {
  param([string]$Message)
  Write-Host ""
  Write-Host "== $Message ==" -ForegroundColor Cyan
}

function Write-Note {
  param([string]$Message)
  Write-Host $Message -ForegroundColor Gray
}

function Write-Warn {
  param([string]$Message)
  Write-Host "WARNING: $Message" -ForegroundColor Yellow
}

function Test-CommandExists {
  param([string]$Name)
  return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Invoke-External {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [string[]]$ArgumentList = @(),
    [string]$WorkingDirectory = $Root,
    [switch]$AllowFailure
  )

  Write-Host "> $FilePath $($ArgumentList -join ' ')" -ForegroundColor DarkGray
  Push-Location $WorkingDirectory
  try {
    & $FilePath @ArgumentList
    $exitCode = $LASTEXITCODE
  }
  finally {
    Pop-Location
  }

  if ($null -eq $exitCode) {
    $exitCode = 0
  }

  if ($exitCode -ne 0) {
    if ($AllowFailure) {
      Write-Warn "$FilePath exited with code $exitCode. Continuing."
      return
    }
    throw "$FilePath exited with code $exitCode"
  }
}

function Install-WingetPackage {
  param(
    [string]$Id,
    [string]$Name
  )

  Write-Step "Installing $Name"
  Invoke-External `
    -FilePath "winget" `
    -ArgumentList @("install", "--id", $Id, "--exact", "--accept-package-agreements", "--accept-source-agreements") `
    -AllowFailure
}

function Refresh-Path {
  $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path = "$machinePath;$userPath"
}

function Get-PythonCommand {
  if (Test-CommandExists "py") {
    & py -3.11 --version *> $null
    if ($LASTEXITCODE -eq 0) {
      return [pscustomobject]@{ File = "py"; Args = @("-3.11") }
    }

    & py -3 --version *> $null
    if ($LASTEXITCODE -eq 0) {
      return [pscustomobject]@{ File = "py"; Args = @("-3") }
    }
  }

  if (Test-CommandExists "python") {
    & python --version *> $null
    if ($LASTEXITCODE -eq 0) {
      return [pscustomobject]@{ File = "python"; Args = @() }
    }
  }

  return $null
}

function Test-PortOpen {
  param(
    [string]$HostName,
    [int]$Port
  )

  $client = New-Object Net.Sockets.TcpClient
  try {
    $async = $client.BeginConnect($HostName, $Port, $null, $null)
    if (-not $async.AsyncWaitHandle.WaitOne(1000, $false)) {
      return $false
    }
    $client.EndConnect($async)
    return $true
  }
  catch {
    return $false
  }
  finally {
    $client.Close()
  }
}

function Ensure-MongoRunning {
  if (Test-PortOpen -HostName "127.0.0.1" -Port 27017) {
    Write-Note "MongoDB is listening on localhost:27017."
    return $true
  }

  $service = Get-Service -Name "MongoDB" -ErrorAction SilentlyContinue
  if ($service) {
    if ($service.Status -ne "Running") {
      Write-Step "Starting MongoDB service"
      Start-Service -Name "MongoDB"
      Start-Sleep -Seconds 4
    }

    if (Test-PortOpen -HostName "127.0.0.1" -Port 27017) {
      Write-Note "MongoDB is listening on localhost:27017."
      return $true
    }
  }

  Write-Warn "MongoDB is not running on localhost:27017. Install/start MongoDB before starting the backend."
  return $false
}

function Ensure-OllamaRunning {
  if (-not (Test-CommandExists "ollama")) {
    Write-Warn "Ollama command not found. AI scoring will not work until Ollama is installed."
    return $false
  }

  if (Test-PortOpen -HostName "127.0.0.1" -Port 11434) {
    Write-Note "Ollama is listening on localhost:11434."
    return $true
  }

  Write-Step "Starting Ollama server"
  Start-Process -FilePath "ollama" -ArgumentList "serve" -WindowStyle Minimized
  Start-Sleep -Seconds 5

  if (Test-PortOpen -HostName "127.0.0.1" -Port 11434) {
    Write-Note "Ollama is listening on localhost:11434."
    return $true
  }

  Write-Warn "Ollama did not start. Open the Ollama app or run 'ollama serve' in another terminal."
  return $false
}

function Copy-EnvIfMissing {
  param(
    [string]$Directory,
    [string]$ExampleName,
    [string]$TargetName
  )

  $example = Join-Path $Directory $ExampleName
  $target = Join-Path $Directory $TargetName

  if ((Test-Path $target) -or -not (Test-Path $example)) {
    return
  }

  Copy-Item -Path $example -Destination $target
  Write-Note "Created $target from $example."
}

function Get-EnvValue {
  param(
    [string]$Path,
    [string]$Name
  )

  if (-not (Test-Path $Path)) {
    return $null
  }

  $pattern = "^\s*" + [regex]::Escape($Name) + "=(.*)$"
  foreach ($line in Get-Content -Path $Path) {
    if ($line -match $pattern) {
      return $Matches[1]
    }
  }

  return $null
}

function Set-EnvValue {
  param(
    [string]$Path,
    [string]$Name,
    [string]$Value
  )

  if (-not (Test-Path $Path)) {
    return
  }

  $content = Get-Content -Path $Path -Raw
  $newLine = "`r`n"
  if ($content -notmatch "`r`n") {
    $newLine = "`n"
  }

  $line = "$Name=$Value"
  $pattern = "(?m)^" + [regex]::Escape($Name) + "=.*$"

  if ([regex]::IsMatch($content, $pattern)) {
    $content = [regex]::Replace($content, $pattern, $line)
  }
  else {
    if (-not $content.EndsWith("`n")) {
      $content += $newLine
    }
    $content += $line + $newLine
  }

  Set-Content -Path $Path -Value $content -Encoding UTF8
}

function New-SecretBase64 {
  $bytes = New-Object byte[] 32
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $rng.GetBytes($bytes)
  }
  finally {
    $rng.Dispose()
  }
  return [Convert]::ToBase64String($bytes)
}

function Set-SecretIfPlaceholder {
  param(
    [string]$Path,
    [string]$Name
  )

  $value = Get-EnvValue -Path $Path -Name $Name
  if ([string]::IsNullOrWhiteSpace($value) -or $value -like "*replace-with*") {
    Set-EnvValue -Path $Path -Name $Name -Value (New-SecretBase64)
    Write-Note "Generated $Name in $Path."
  }
}

function Get-LanIp {
  try {
    $addresses = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
      Where-Object {
        $_.IPAddress -notlike "127.*" -and
        $_.IPAddress -match "^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)" -and
        $_.InterfaceAlias -notmatch "Loopback|vEthernet|Virtual|VMware|VirtualBox|Docker"
      } |
      Sort-Object `
        @{ Expression = { if ($_.InterfaceAlias -match "Wi-Fi|Ethernet") { 0 } else { 1 } } }, `
        InterfaceMetric

    $first = $addresses | Select-Object -First 1
    if ($first) {
      return $first.IPAddress
    }
  }
  catch {
    Write-Warn "Could not detect LAN IP automatically: $($_.Exception.Message)"
  }

  return $null
}

function Assert-ProjectShape {
  foreach ($path in @($Backend, $Admin, $Mobile)) {
    if (-not (Test-Path $path)) {
      throw "Missing expected project folder: $path"
    }
  }
}

Assert-ProjectShape

Write-Step "V-Prep Windows setup"
Write-Note "Project root: $Root"

if ($InstallPrerequisites) {
  if (-not (Test-CommandExists "winget")) {
    throw "winget is not available. Install prerequisites manually, then rerun this script."
  }

  if (-not (Get-PythonCommand)) {
    Install-WingetPackage -Id "Python.Python.3.11" -Name "Python 3.11"
  }
  if (-not (Test-CommandExists "npm")) {
    Install-WingetPackage -Id "OpenJS.NodeJS.LTS" -Name "Node.js LTS"
  }
  if (-not (Test-CommandExists "mongod")) {
    Install-WingetPackage -Id "MongoDB.Server" -Name "MongoDB Server"
  }
  if (-not (Test-CommandExists "ollama")) {
    Install-WingetPackage -Id "Ollama.Ollama" -Name "Ollama"
  }
  if (-not (Test-CommandExists "tesseract")) {
    Install-WingetPackage -Id "UB-Mannheim.TesseractOCR" -Name "Tesseract OCR"
  }

  Refresh-Path
}

Write-Step "Checking required commands"
$python = Get-PythonCommand
$missing = @()

if (-not $python) {
  $missing += "Python 3.11 or newer"
}
if (-not (Test-CommandExists "npm")) {
  $missing += "Node.js/npm"
}
if (-not (Test-CommandExists "ollama")) {
  $missing += "Ollama"
}
if (-not (Test-CommandExists "tesseract")) {
  Write-Warn "Tesseract command not found. Image/OCR scoring may fail until it is installed and added to PATH."
}

if ($missing.Count -gt 0) {
  throw "Missing prerequisites: $($missing -join ', '). Install them or rerun with -InstallPrerequisites."
}

Write-Step "Creating local environment files"
Copy-EnvIfMissing -Directory $Backend -ExampleName ".env.example" -TargetName ".env"
Copy-EnvIfMissing -Directory $Admin -ExampleName ".env.example" -TargetName ".env.local"
Copy-EnvIfMissing -Directory $Mobile -ExampleName ".env.example" -TargetName ".env"

$backendEnv = Join-Path $Backend ".env"
$adminEnv = Join-Path $Admin ".env.local"
$mobileEnv = Join-Path $Mobile ".env"

Set-SecretIfPlaceholder -Path $backendEnv -Name "SECRET_KEY"
Set-SecretIfPlaceholder -Path $adminEnv -Name "NEXTAUTH_SECRET"
Set-SecretIfPlaceholder -Path $adminEnv -Name "AUTH_SECRET"

$lanIp = Get-LanIp
if ($lanIp) {
  Write-Step "Updating machine-specific URLs"
  Write-Note "Detected LAN IP: $lanIp"

  Set-EnvValue -Path $mobileEnv -Name "EXPO_PUBLIC_API_URL" -Value "http://$lanIp:8000"
  Set-EnvValue -Path $mobileEnv -Name "EXPO_PUBLIC_ADMIN_URL" -Value "http://$lanIp:3000"
  Set-EnvValue -Path $adminEnv -Name "NEXT_PUBLIC_API_URL" -Value "http://localhost:8000"

  $origins = @(
    "http://localhost:3000",
    "http://localhost:8081",
    "http://localhost:8082",
    "http://localhost:19000",
    "http://localhost:19006",
    "http://$lanIp:3000",
    "http://$lanIp:8081",
    "http://$lanIp:8082",
    "http://$lanIp:19000",
    "http://$lanIp:19006",
    "exp://localhost:8081",
    "exp://localhost:8082",
    "exp://$lanIp:8081",
    "exp://$lanIp:8082"
  ) -join ","
  Set-EnvValue -Path $backendEnv -Name "ALLOWED_ORIGINS" -Value $origins
}
else {
  Write-Warn "No LAN IP was detected. Update mobile/.env manually if testing on a physical phone."
}

$firebaseServiceAccount = Join-Path $Backend "firebase-service-account.json"
if (-not (Test-Path $firebaseServiceAccount)) {
  throw "Missing backend/firebase-service-account.json. Copy it from the old laptop or download it from Firebase, then rerun setup."
}

$googleServices = Join-Path $Mobile "google-services.json"
if (-not (Test-Path $googleServices)) {
  Write-Warn "Missing mobile/google-services.json. Android Firebase sign-in may fail until it is added."
}

$googleClientSecret = Get-EnvValue -Path $adminEnv -Name "GOOGLE_CLIENT_SECRET"
if ([string]::IsNullOrWhiteSpace($googleClientSecret) -or $googleClientSecret -like "*replace-with*") {
  Write-Warn "admin/.env.local still has a placeholder GOOGLE_CLIENT_SECRET. Demo login can work, but Google admin login needs the real secret."
}

Write-Step "Preparing backend Python environment"
$venvPython = Join-Path $Backend ".venv\Scripts\python.exe"
if (-not (Test-Path $venvPython)) {
  Invoke-External -FilePath $python.File -ArgumentList ($python.Args + @("-m", "venv", ".venv")) -WorkingDirectory $Backend
}

if (-not $SkipPipInstall) {
  Invoke-External -FilePath $venvPython -ArgumentList @("-m", "pip", "install", "--upgrade", "pip") -WorkingDirectory $Backend
  Invoke-External -FilePath $venvPython -ArgumentList @("-m", "pip", "install", "-r", "requirements.txt") -WorkingDirectory $Backend
}

if (-not $SkipNpmInstall) {
  Write-Step "Installing admin dependencies"
  Invoke-External -FilePath "npm" -ArgumentList @("install") -WorkingDirectory $Admin

  Write-Step "Installing mobile dependencies"
  Invoke-External -FilePath "npm" -ArgumentList @("install") -WorkingDirectory $Mobile
}

Write-Step "Checking local services"
$mongoReady = Ensure-MongoRunning
$ollamaReady = Ensure-OllamaRunning

if ($ollamaReady -and -not $SkipModelPull) {
  Write-Step "Pulling Ollama models"
  Invoke-External -FilePath "ollama" -ArgumentList @("pull", "llama3.2:3b") -AllowFailure
  Invoke-External -FilePath "ollama" -ArgumentList @("pull", "qwen2.5-coder:7b") -AllowFailure
}

if ($mongoReady) {
  Write-Step "Seeding interview question bank"
  Invoke-External -FilePath $venvPython -ArgumentList @("scripts\seed_questions.py") -WorkingDirectory $Backend -AllowFailure

  if ($SeedDemoData) {
    Write-Step "Seeding demo dashboard data"
    Invoke-External -FilePath $venvPython -ArgumentList @("scripts\seed_demo_data.py") -WorkingDirectory $Backend -AllowFailure
  }
}

Write-Step "Setup complete"
Write-Host "Start the project with:" -ForegroundColor Green
Write-Host "  powershell -ExecutionPolicy Bypass -File .\start-windows.ps1" -ForegroundColor Green
Write-Host ""
Write-Host "URLs:" -ForegroundColor Green
Write-Host "  Backend health: http://localhost:8000/health"
Write-Host "  Admin portal:   http://localhost:3000"
Write-Host "  Expo mobile:    shown in the mobile terminal after start"
