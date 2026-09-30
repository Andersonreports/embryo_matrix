<#
  EmbryoMatrix file sync - copies embryo images, TRF PDFs, protocol documents,
  and uploaded result spreadsheets from the hosted tracker to this PC's local
  storage, organized by sequencing run.

  Runs on the lab's storage PC. Only makes outgoing HTTPS requests to the
  tracker, so no firewall/port changes are needed on this machine.

  Saved as (the server decides every path and returns it as "relPath"):
    <Destination>\<Year>\<MM - Month>\RUN_<id>\<Patient>\<embryo>_<id>_<file>   (embryo images)
    <Destination>\<Year>\<MM - Month>\RUN_<id>\<Patient>\TRF.pdf                (TRF PDF)
    <Destination>\<Year>\<MM - Month>\RUN_<id>\Results\<file name>              (result spreadsheets)
    <Destination>\_Unassigned\<Patient> (<case>)\...                            (patient not found in any run yet)
    <Destination>\TRFS\<ref>_<patient>.pdf                                      (TRF PDF, not linked to a case yet)
    <Destination>\_ResultFiles\<file name>                                      (result spreadsheet, run not found)
    <Destination>\_Protocols\<id>_<file name>                                   (protocol docs - unaffected by runs)

  The month/year of a run is the received date of its first sample in the
  Sequencing Batch Record. When a file's path changes (a patient gets matched to
  a run, a run's month is corrected, ...) the local copy is MOVED to the new
  path on the next pass - see Invoke-PlacedSyncPass. Local copies are never
  deleted, even if the original is removed in the tracker.

  Files may be gzip-compressed on the server; the API decompresses them on
  download automatically, so nothing here needs to unzip anything.

  Usage:
    powershell -ExecutionPolicy Bypass -File sync-images.ps1          # keep running, sync every N minutes
    powershell -ExecutionPolicy Bypass -File sync-images.ps1 -Once    # one pass then exit (for Task Scheduler)
#>
param([switch]$Once)

$ErrorActionPreference = 'Stop'
$here            = Split-Path -Parent $MyInvocation.MyCommand.Path
$configPath      = Join-Path $here 'sync-config.json'
$placedStatePath = Join-Path $here 'sync-state-placed.json'
$protoStatePath  = Join-Path $here 'sync-state-protocols.json'
$logPath         = Join-Path $here 'sync.log'

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

function Read-JsonState([string]$path, $default) {
    if (Test-Path $path) { return (Get-Content $path -Raw | ConvertFrom-Json) }
    return $default
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

# Images, TRF PDFs and result spreadsheets: the server lists every file with the
# path it belongs at (relPath). Each pass downloads what is missing and MOVES what
# is already local but now belongs elsewhere. sync-state-placed.json remembers
# where each file was last put, keyed like "img:12".
function Invoke-PlacedSyncPass {
    $headers = @{ 'X-Image-Sync-Key' = $config.SyncKey }
    $placed = @{}
    if (Test-Path $placedStatePath) {
        (Get-Content $placedStatePath -Raw | ConvertFrom-Json).PSObject.Properties | ForEach-Object { $placed[$_.Name] = [string]$_.Value }
    }

    $items = @()
    foreach ($src in @(
        @{ prefix = 'img'; path = '/api/images';       label = 'image';       name = { param($x) $x.filename } },
        @{ prefix = 'trf'; path = '/api/trf-files';    label = 'TRF PDF';     name = { param($x) $x.ref } },
        @{ prefix = 'rf';  path = '/api/result-files'; label = 'result file'; name = { param($x) $x.fileName } })) {
        try {
            $resp = Invoke-RestMethod -Uri ($server + $src.path) -Headers $headers -TimeoutSec 120
            foreach ($x in @($resp | ForEach-Object { $_ })) {
                if ($x.relPath) { $items += [pscustomobject]@{ key = "$($src.prefix):$($x.id)"; rel = [string]$x.relPath; url = [string]$x.url; label = $src.label; name = (& $src.name $x) } }
            }
        } catch { Write-Log "Listing $($src.label)s failed: $($_.Exception.Message)" }
    }

    $downloaded = 0; $moved = 0
    foreach ($it in $items) {
        if ($it.rel -match '(^|[\\/])\.\.([\\/]|$)') { Write-Log "Skipped unsafe path $($it.rel)"; continue }
        $target = Join-Path $dest ($it.rel -replace '/', '\')
        $old    = $null
        if ($placed.ContainsKey($it.key)) { $old = Join-Path $dest ($placed[$it.key] -replace '/', '\') }

        if ((Test-Path $target)) { $placed[$it.key] = $it.rel; continue }
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null

        if ($old -and (Test-Path $old)) {
            Move-Item -Path $old -Destination $target -Force
            Write-Log "Moved $($it.label) $($it.name): $($placed[$it.key]) -> $($it.rel)"
            $moved++
            # Tidy up a folder the move left empty.
            $dir = Split-Path -Parent $old
            while ($dir -and ($dir.Length -gt $dest.Length) -and (Test-Path $dir) -and -not (Get-ChildItem $dir -Force)) {
                Remove-Item $dir -Force -ErrorAction SilentlyContinue
                $dir = Split-Path -Parent $dir
            }
        } else {
            try {
                Invoke-WebRequest -Uri ($server + $it.url) -OutFile $target -UseBasicParsing -TimeoutSec 300
            } catch {
                if (Test-Path $target) { Remove-Item $target -Force }
                Write-Log "FAILED $($it.label) $($it.name): $($_.Exception.Message)"
                continue
            }
            Write-Log "Saved $target"
            $downloaded++
        }
        $placed[$it.key] = $it.rel
        $placed | ConvertTo-Json | Set-Content -Path $placedStatePath -Encoding UTF8
    }
    if ($placed.Count) { $placed | ConvertTo-Json | Set-Content -Path $placedStatePath -Encoding UTF8 }
    if ($downloaded -or $moved) { Write-Log "Placed files: $downloaded downloaded, $moved moved" }
}

Write-Log "File sync started - $server -> $dest"
while ($true) {
    try { Invoke-PlacedSyncPass } catch { Write-Log "File sync error: $($_.Exception.Message)" }
    try { Invoke-ProtocolSyncPass } catch { Write-Log "Protocol sync error: $($_.Exception.Message)" }
    if ($Once) { break }
    Start-Sleep -Seconds ($interval * 60)
}
