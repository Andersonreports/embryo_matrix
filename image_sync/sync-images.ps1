<#
  EmbryoMatrix file sync - copies embryo images, protocol documents, and
  uploaded result spreadsheets from the hosted tracker to this PC's local
  storage.

  Runs on the lab's storage PC. Only makes outgoing HTTPS requests to the
  tracker, so no firewall/port changes are needed on this machine.

  Saved as:
    <Destination>\<Case ID>\<Embryo>\<id>_<file name>       (images)
    <Destination>\_Protocols\<id>_<file name>               (protocol docs)
    <Destination>\_ResultFiles\<id>_<file name>             (result spreadsheets)
  Local copies are never deleted, even if the original is removed in the tracker.

  Usage:
    powershell -ExecutionPolicy Bypass -File sync-images.ps1          # keep running, sync every N minutes
    powershell -ExecutionPolicy Bypass -File sync-images.ps1 -Once    # one pass then exit (for Task Scheduler)
#>
param([switch]$Once)

$ErrorActionPreference = 'Stop'
$here          = Split-Path -Parent $MyInvocation.MyCommand.Path
$configPath    = Join-Path $here 'sync-config.json'
$statePath     = Join-Path $here 'sync-state.json'
$protoStatePath = Join-Path $here 'sync-state-protocols.json'
$rfStatePath   = Join-Path $here 'sync-state-resultfiles.json'
$logPath       = Join-Path $here 'sync.log'

function Write-Log($msg) {
    $line = "{0}  {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
    Write-Host $line
    Add-Content -Path $logPath -Value $line -Encoding UTF8
}

function Get-SafeName([string]$name, [string]$fallback) {
    if ([string]::IsNullOrWhiteSpace($name)) { return $fallback }
    $bad = [IO.Path]::GetInvalidFileNameChars() -join ''
    $clean = ($name -replace "[$([regex]::Escape($bad))]", '_').Trim().TrimEnd('.')
    if ($clean) { return $clean } else { return $fallback }
}

if (-not (Test-Path $configPath)) {
    Write-Host "Missing $configPath - copy sync-config.example.json to sync-config.json and fill it in."
    exit 1
}
$config   = Get-Content $configPath -Raw | ConvertFrom-Json
$server   = $config.ServerUrl.TrimEnd('/')
$dest     = $config.Destination
$interval = [int]$config.IntervalMinutes
if ($interval -lt 1) { $interval = 5 }

# PowerShell 5.1 defaults to old TLS versions; hosted servers need TLS 1.2.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Invoke-ImageSyncPass {
    $lastId = 0
    if (Test-Path $statePath) { $lastId = [int]((Get-Content $statePath -Raw | ConvertFrom-Json).lastId) }

    $headers = @{ 'X-Image-Sync-Key' = $config.SyncKey }
    $resp    = Invoke-RestMethod -Uri "$server/api/images?since_id=$lastId" -Headers $headers -TimeoutSec 60
    # Windows PowerShell 5.1 hands back a JSON array as one object; unroll it.
    $images  = @($resp | ForEach-Object { $_ } | Sort-Object { [int]$_.id })
    if (-not $images.Count) { return }

    Write-Log "Found $($images.Count) new image(s)"
    foreach ($img in $images) {
        $caseDir   = Get-SafeName $img.caseId 'Unknown case'
        $embryoDir = Get-SafeName $img.embryo 'No embryo label'
        $folder    = Join-Path (Join-Path $dest $caseDir) $embryoDir
        New-Item -ItemType Directory -Force -Path $folder | Out-Null
        $file = Join-Path $folder ("{0}_{1}" -f $img.id, (Get-SafeName $img.filename "image$($img.id)"))

        if (-not (Test-Path $file)) {
            try {
                Invoke-WebRequest -Uri ($server + $img.url) -OutFile $file -UseBasicParsing -TimeoutSec 300
            } catch {
                # Stop here so this image is retried on the next pass.
                if (Test-Path $file) { Remove-Item $file -Force }
                Write-Log "FAILED image $($img.id) ($($img.filename)): $($_.Exception.Message)"
                return
            }
            Write-Log "Saved $file"
        }
        @{ lastId = [int]$img.id } | ConvertTo-Json | Set-Content -Path $statePath -Encoding UTF8
    }
}

function Invoke-ProtocolSyncPass {
    $lastId = 0
    if (Test-Path $protoStatePath) { $lastId = [int]((Get-Content $protoStatePath -Raw | ConvertFrom-Json).lastId) }

    $headers = @{ 'X-Image-Sync-Key' = $config.SyncKey }
    $resp    = Invoke-RestMethod -Uri "$server/api/protocols?since_id=$lastId" -Headers $headers -TimeoutSec 60
    $docs    = @($resp | ForEach-Object { $_ } | Sort-Object { [int]$_.id })
    if (-not $docs.Count) { return }

    Write-Log "Found $($docs.Count) new protocol document(s)"
    $folder = Join-Path $dest '_Protocols'
    New-Item -ItemType Directory -Force -Path $folder | Out-Null
    foreach ($doc in $docs) {
        $file = Join-Path $folder ("{0}_{1}" -f $doc.id, (Get-SafeName $doc.filename "protocol$($doc.id)"))
        if (-not (Test-Path $file)) {
            try {
                Invoke-WebRequest -Uri ($server + $doc.url) -OutFile $file -UseBasicParsing -TimeoutSec 300
            } catch {
                if (Test-Path $file) { Remove-Item $file -Force }
                Write-Log "FAILED protocol $($doc.id) ($($doc.filename)): $($_.Exception.Message)"
                return
            }
            Write-Log "Saved $file"
        }
        @{ lastId = [int]$doc.id } | ConvertTo-Json | Set-Content -Path $protoStatePath -Encoding UTF8
    }
}

function Invoke-ResultFileSyncPass {
    $since = ''
    if (Test-Path $rfStatePath) { $since = [string]((Get-Content $rfStatePath -Raw | ConvertFrom-Json).lastAt) }

    $headers = @{ 'X-Image-Sync-Key' = $config.SyncKey }
    $uri     = "$server/api/result-files"
    if ($since) { $uri = "$uri`?since=$([Uri]::EscapeDataString($since))" }
    $resp    = Invoke-RestMethod -Uri $uri -Headers $headers -TimeoutSec 60
    # Already returned oldest-first by the server, so PS's array unrolling keeps that order.
    $rfiles  = @($resp | ForEach-Object { $_ })
    if (-not $rfiles.Count) { return }

    Write-Log "Found $($rfiles.Count) new result file(s)"
    $folder = Join-Path $dest '_ResultFiles'
    New-Item -ItemType Directory -Force -Path $folder | Out-Null
    foreach ($rf in $rfiles) {
        $label = if ($rf.run) { "$($rf.run)_$($rf.fileName)" } else { $rf.fileName }
        $file  = Join-Path $folder (Get-SafeName $label "resultfile_$($rf.id)")
        if (-not (Test-Path $file)) {
            try {
                Invoke-WebRequest -Uri ($server + $rf.url) -OutFile $file -UseBasicParsing -TimeoutSec 300
            } catch {
                if (Test-Path $file) { Remove-Item $file -Force }
                Write-Log "FAILED result file $($rf.id) ($($rf.fileName)): $($_.Exception.Message)"
                return
            }
            Write-Log "Saved $file"
        }
        @{ lastAt = [string]$rf.at } | ConvertTo-Json | Set-Content -Path $rfStatePath -Encoding UTF8
    }
}

Write-Log "File sync started - $server -> $dest"
while ($true) {
    try { Invoke-ImageSyncPass } catch { Write-Log "Image sync error: $($_.Exception.Message)" }
    try { Invoke-ProtocolSyncPass } catch { Write-Log "Protocol sync error: $($_.Exception.Message)" }
    try { Invoke-ResultFileSyncPass } catch { Write-Log "Result file sync error: $($_.Exception.Message)" }
    if ($Once) { break }
    Start-Sleep -Seconds ($interval * 60)
}
