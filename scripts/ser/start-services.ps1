param(
  [string]$RepoPath = "$env:USERPROFILE\\tenkings-backend",
  [string]$ChromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  [string]$DisplaySlug = "sacramento-kings-golden-1-center"
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

Start-DetachedCommand -Title "Next.js" -Command "cd `"$RepoPath`"; pnpm --filter @tenkings/nextjs-app dev"
Start-DetachedCommand -Title "Kiosk Agent" -Command "cd `"$RepoPath`"; pnpm --filter @tenkings/kiosk-agent start"

if (Test-Path $ChromePath) {
  Start-Process -FilePath $ChromePath -ArgumentList "--kiosk", "http://localhost:3000/kiosk" -WindowStyle Maximized -ErrorAction SilentlyContinue
  Start-Process -FilePath $ChromePath -ArgumentList "--kiosk", "http://localhost:3000/kiosk/display?slug=$DisplaySlug" -WindowStyle Maximized -ErrorAction SilentlyContinue
  Write-Host "Launched Chrome kiosk windows"
} else {
  Write-Warning "Chrome executable not found at $ChromePath"
}
