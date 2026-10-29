<#
  Registers a Windows scheduled task that runs sync-images.ps1 every few
  minutes in the background, including after restarts. Run once, as
  Administrator, on the storage PC:

    powershell -ExecutionPolicy Bypass -File install-sync-task.ps1

  To remove it later:  Unregister-ScheduledTask -TaskName "EmbryoMatrix Image Sync"
#>
$ErrorActionPreference = 'Stop'
$here   = Split-Path -Parent $MyInvocation.MyCommand.Path
$script = Join-Path $here 'sync-images.ps1'
$config = Get-Content (Join-Path $here 'sync-config.json') -Raw | ConvertFrom-Json
$every  = [int]$config.IntervalMinutes
if ($every -lt 1) { $every = 5 }

$action   = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`" -Once" -WorkingDirectory $here
$trigger  = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes $every)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 2)
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest

Register-ScheduledTask -TaskName 'EmbryoMatrix Image Sync' -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Write-Host "Installed. Images will sync every $every minute(s) into $($config.Destination). Log: $(Join-Path $here 'sync.log')"
