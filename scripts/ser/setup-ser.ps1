param(
  [string]$RepoPath = "$env:USERPROFILE\tenkings-backend",
  [Parameter(Mandatory=$true)][string]$LocationSlug,
  [string]$LocationId,
  [Parameter(Mandatory=$true)][string]$KioskSecret,
  [Parameter(Mandatory=$true)][string]$DatabaseUrl,
  [string]$BaseUrl = "https://collect.tenkings.co",
  [string]$ObsAddress = "ws://127.0.0.1:4455",
  [string]$ObsPassword = "changeme",
  [string]$SceneAttract = "Attract Loop",
  [string]$SceneCountdown = "Intro Countdown",
  [string]$SceneLive = "Live Rip",
  [string]$SceneReveal = "Slab Reveal",
  [int]$CountdownSeconds = 10,
  [int]$LiveSeconds = 60,
  [int]$ManualRevealMs = 10000,
  [int]$ManualRevealCooldownMs = 5000,
  [int]$PollIntervalMs = 4000,
  [switch]$SkipKioskDisplayEnv,
  [switch]$SkipKioskAgentEnv,
  [string]$DisplaySlug
)

if (-not $DisplaySlug) {
  $DisplaySlug = $LocationSlug
}

function New-EnvFile {
  param(
    [string]$TargetPath,
    [string[]]$Lines
  )

  $dir = Split-Path $TargetPath
  if (-not (Test-Path $dir)) {
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
  }

  $hasTarget = Test-Path $TargetPath -PathType Leaf
  $hasBackup = Test-Path "$TargetPath.bak"
  if ($hasTarget -and -not $hasBackup) {
    Copy-Item $TargetPath "$TargetPath.bak"
  }

  "Writing $TargetPath" | Write-Host
  $Lines -join "`n" | Set-Content -Path $TargetPath -Encoding ASCII
}

if (-not $SkipKioskDisplayEnv) {
  $nextEnvPath = Join-Path $RepoPath "frontend\nextjs-app\.env.local"
  $nextEnvLines = @(
    "DATABASE_URL=$DatabaseUrl",
    "NEXT_PUBLIC_KIOSK_API_SECRET=$KioskSecret",
    "NEXT_PUBLIC_KIOSK_COUNTDOWN_SECONDS=$CountdownSeconds",
    "NEXT_PUBLIC_KIOSK_LIVE_SECONDS=$LiveSeconds",
    "NEXT_PUBLIC_MANUAL_REVEAL_MS=$ManualRevealMs",
    "NEXT_PUBLIC_MANUAL_REVEAL_COOLDOWN_MS=$ManualRevealCooldownMs",
    "NEXT_PUBLIC_KIOSK_ATTRACT_VIDEO_URL=",
    "NEXT_PUBLIC_OBS_WS_URL=$ObsAddress",
    "NEXT_PUBLIC_OBS_WS_PASSWORD=$ObsPassword",
    "NEXT_PUBLIC_OBS_SCENE_ATTRACT=$SceneAttract",
    "NEXT_PUBLIC_OBS_SCENE_COUNTDOWN=$SceneCountdown",
    "NEXT_PUBLIC_OBS_SCENE_LIVE=$SceneLive",
    "NEXT_PUBLIC_OBS_SCENE_REVEAL=$SceneReveal"
  )
  New-EnvFile -TargetPath $nextEnvPath -Lines $nextEnvLines
}

if (-not $SkipKioskAgentEnv) {
  $agentEnvPath = Join-Path $RepoPath "packages\kiosk-agent\.env.local"
  $agentEnvLines = @(
    "KIOSK_AGENT_BASE_URL=$BaseUrl",
    "KIOSK_AGENT_LOCATION_SLUG=$LocationSlug"
  )
  if ($LocationId) {
    $agentEnvLines += "KIOSK_AGENT_LOCATION_ID=$LocationId"
  }
  $agentEnvLines += @(
    "KIOSK_AGENT_POLL_INTERVAL_MS=$PollIntervalMs",
    "OBS_ADDRESS=$ObsAddress",
    "OBS_PASSWORD=$ObsPassword",
    "OBS_SCENE_ATTRACT=$SceneAttract",
    "OBS_SCENE_COUNTDOWN=$SceneCountdown",
    "OBS_SCENE_LIVE=$SceneLive",
    "OBS_SCENE_REVEAL=$SceneReveal",
    "OBS_AUTO_START_STREAM=true",
    "OBS_AUTO_STOP_STREAM=true",
    "OBS_AUTO_RECORD=false",
    "KIOSK_AGENT_SECRET=$KioskSecret",
    "KIOSK_AGENT_SCANNER_ENABLED=true",
    "KIOSK_AGENT_SCANNER_MIN_LENGTH=6",
    "KIOSK_AGENT_SCANNER_COOLDOWN_MS=1500",
    "KIOSK_AGENT_SCANNER_IDLE_RESET_MS=250",
    "KIOSK_AGENT_COUNTDOWN_SECONDS=$CountdownSeconds",
    "KIOSK_AGENT_LIVE_SECONDS=$LiveSeconds"
  )
  New-EnvFile -TargetPath $agentEnvPath -Lines $agentEnvLines
}

Write-Host "Environment files created. Update Task Scheduler to run start-services.ps1 with DisplaySlug '$DisplaySlug'."
