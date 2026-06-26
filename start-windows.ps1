param(
  [switch]$SkipMobile,
  [switch]$SkipAdmin,
  [switch]$SkipBackend
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Backend = Join-Path $Root "backend"
$Admin = Join-Path $Root "admin"
$Mobile = Join-Path $Root "mobile"

function Quote-PowerShellString {
  param([string]$Value)
  return "'" + $Value.Replace("'", "''") + "'"
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

function Start-MongoIfPossible {
  if (Test-PortOpen -HostName "127.0.0.1" -Port 27017) {
    return
  }

  $service = Get-Service -Name "MongoDB" -ErrorAction SilentlyContinue
  if ($service -and $service.Status -ne "Running") {
    Start-Service -Name "MongoDB"
    Start-Sleep -Seconds 4
  }
}

function Start-OllamaIfPossible {
  if (Test-PortOpen -HostName "127.0.0.1" -Port 11434) {
    return
  }

  if (Get-Command "ollama" -ErrorAction SilentlyContinue) {
    Start-Process -FilePath "ollama" -ArgumentList "serve" -WindowStyle Minimized
    Start-Sleep -Seconds 4
  }
}

function Start-Terminal {
  param(
    [string]$Title,
    [string]$Command
  )

  $fullCommand = "`$Host.UI.RawUI.WindowTitle = " + (Quote-PowerShellString $Title) + "; " + $Command
  Start-Process -FilePath "powershell.exe" -ArgumentList @(
    "-NoExit",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    $fullCommand
  )
}

Start-MongoIfPossible
Start-OllamaIfPossible

if (-not $SkipBackend) {
  $backendPython = Join-Path $Backend ".venv\Scripts\python.exe"
  if (-not (Test-Path $backendPython)) {
    throw "Backend virtualenv not found. Run .\setup-windows.ps1 first."
  }

  $backendCommand = "Set-Location -LiteralPath " + (Quote-PowerShellString $Backend) + "; & " + (Quote-PowerShellString $backendPython) + " -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload"
  Start-Terminal -Title "V-Prep Backend" -Command $backendCommand
}

if (-not $SkipAdmin) {
  if (-not (Test-Path (Join-Path $Admin "node_modules"))) {
    throw "Admin dependencies not found. Run .\setup-windows.ps1 first."
  }

  $adminCommand = "Set-Location -LiteralPath " + (Quote-PowerShellString $Admin) + "; npm run dev"
  Start-Terminal -Title "V-Prep Admin" -Command $adminCommand
}

if (-not $SkipMobile) {
  if (-not (Test-Path (Join-Path $Mobile "node_modules"))) {
    throw "Mobile dependencies not found. Run .\setup-windows.ps1 first."
  }

  $mobileCommand = "Set-Location -LiteralPath " + (Quote-PowerShellString $Mobile) + "; npm start"
  Start-Terminal -Title "V-Prep Mobile" -Command $mobileCommand
}

Write-Host ""
Write-Host "Started V-Prep terminals." -ForegroundColor Green
Write-Host "Backend health: http://localhost:8000/health"
Write-Host "Admin portal:   http://localhost:3000"
