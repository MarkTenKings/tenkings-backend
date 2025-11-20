param(
  [string]$RepoPath = "$env:USERPROFILE\\tenkings-backend",
  [string]$ChromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  [string]$DisplaySlug = "sacramento-kings-golden-1-center",
  [string]$KioskUrl = "http://localhost:3000/kiosk",
  [string]$DisplayUrlTemplate = "http://localhost:3000/kiosk/display?slug={slug}",
  [string]$ObsPath = "C:\\Program Files\\obs-studio\\bin\\64bit\\obs64.exe",
  [switch]$LaunchObs,
  [switch]$SkipChrome,
  [switch]$SkipNext,
  [switch]$SkipAgent
)

function Start-DetachedCommand {
  param(
    [string]$Title,
    [string]$Command
  )

  Start-Process -FilePath "powershell.exe" -ArgumentList "-NoExit", "-Command", $Command -WindowStyle Minimized -WorkingDirectory $RepoPath -ErrorAction Stop | Out-Null
  Write-Host "Started $Title"
}

if (-not (Test-Path $RepoPath)) {
  Write-Error "Repo path '$RepoPath' not found."
  exit 1
}

if ($LaunchObs -and (Test-Path $ObsPath)) {
  if (-not (Get-Process obs64 -ErrorAction SilentlyContinue)) {
    Start-Process -FilePath $ObsPath -ErrorAction SilentlyContinue
    Write-Host "Launched OBS from $ObsPath"
    Start-Sleep -Seconds 5
  } else {
    Write-Host "OBS already running"
  }
}

if (-not $SkipNext) {
  Start-DetachedCommand -Title "Next.js" -Command "cd `"$RepoPath`"; pnpm --filter @tenkings/nextjs-app dev"
}

if (-not $SkipAgent) {
  Start-DetachedCommand -Title "Kiosk Agent" -Command "cd `"$RepoPath`"; pnpm --filter @tenkings/kiosk-agent start"
}

if (-not $SkipChrome) {
  if (Test-Path $ChromePath) {
    Start-Process -FilePath $ChromePath -ArgumentList "--kiosk", $KioskUrl -WindowStyle Maximized -ErrorAction SilentlyContinue
    $displayUrl = $DisplayUrlTemplate -replace "\{slug\}", $DisplaySlug
    Start-Process -FilePath $ChromePath -ArgumentList "--kiosk", $displayUrl -WindowStyle Maximized -ErrorAction SilentlyContinue
    Write-Host "Launched Chrome kiosk windows"
  } else {
    Write-Warning "Chrome executable not found at $ChromePath"
  }
}
