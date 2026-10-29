# EmbryoMatrix file sync

Automatically copies every embryo image, digital TRF PDF, protocol document,
and uploaded result spreadsheet from EmbryoMatrix onto this PC's local
storage — a second, independent copy that lives off the server, organized by
year, month, sequencing run and patient. You set it up once; after that it runs by itself in the
background every few minutes, including after the PC restarts. Nobody needs
to run anything day to day.

Files are saved like this (the server decides every path):

```
D:\EmbryoMatrix\
  2026\
    09 - September\                  <- month of the run's first sample "received" date
      RUN_30\
        TAMILSELVI\                  <- one folder per patient in the run
          TS-1_12_embryo image.png    <- embryo images (embryo label first)
          TRF.pdf
        ARUL PRIYA S\
          ...
        Results\
          Analysis_Run 30-PGS-Fastaseq-Manipal-28-09-2026.xlsx
      RUN_33\
        ...
  _Unassigned\
    Jane Doe (ADK0000006512)\        <- patient not found in any run of the Sequencing Batch Record
  TRFS\
    TRF-260101-AB12_Jane Doe.pdf      <- TRF not yet linked to a case
  _ResultFiles\
    Analysis_Legacy.xlsx              <- result file whose run isn't in the Sequencing Batch Record
  _Protocols\
    3_SOP-PGTA-v2.pdf
```

A patient's run is found by matching their name and embryo tag in the Sequencing
Batch Record (exact match); if that finds nothing, the run set with the RUN badge
in the app is used. When a file's location changes (a patient gets matched to a run,
a run's date is corrected) the local copy is **moved** to the new path on the next
sync. Local copies are never deleted, even if the original is removed in the tracker.

## Requirements

- A Windows PC with enough free disk space (Windows PowerShell is built in, so nothing needs installing).
- Network access to the tracker's address (LAN or internet, whichever applies). The PC only makes outgoing requests, so no firewall or router changes are needed.

## One-time setup

1. Copy this `image_sync` folder to the storage PC, e.g. `C:\EmbryoMatrixSync`.
2. In that folder, copy `sync-config.example.json` to `sync-config.json` and fill it in:
   - `ServerUrl`: the tracker's address, e.g. `http://192.168.1.50:8001` or `https://tracker.yourcompany.com`
   - `SyncKey`: the `IMAGE_SYNC_TOKEN` value from the tracker server's `.env`. Ask whoever runs the server for it. (Same key covers images, TRF PDFs, protocols, and result files — it only ever grants read/download access.)
   - `Destination`: where to save everything, e.g. `D:\\EmbryoMatrix` (use double backslashes)
   - `IntervalMinutes`: how often to check for new files (5 is fine)
3. Test it once. Open PowerShell in the folder and run:
   ```
   powershell -ExecutionPolicy Bypass -File sync-images.ps1 -Once
   ```
   You should see "Found N new image(s)" / "protocol document(s)" / "result file(s)" and the files should appear in the destination.
4. Turn on automatic syncing. Open PowerShell **as Administrator** in the folder and run:
   ```
   powershell -ExecutionPolicy Bypass -File install-sync-task.ps1
   ```

That's it. It now runs every few minutes in the background as a Windows scheduled task named **EmbryoMatrix Image Sync**, whether or not anyone is logged in.

If you already had this set up, replace `sync-images.ps1` with the new version and leave everything else as-is. The next run downloads every image, TRF and result file again into the new Year\Month\Run\Patient layout (progress is tracked in `sync-state-placed.json`). Folders from the older layouts (`RUN_<id>\<case>`, `_Unassigned\<case>`, flat `<case>\<embryo>`) are not touched - delete them yourself once you have checked the new folders.

## Checking it's working

- `sync.log` in the folder records every file saved, every moved-into-a-run-folder case, and any errors.
- `sync-state-placed.json` records where each image / TRF / result file was last put, which is how the script knows to move it when its path changes. `sync-state-protocols.json` records how far protocol documents have synced. Delete one to re-check from the start; files already at the right path are skipped, not re-downloaded.

## Turning it off

In an Administrator PowerShell:

```
Unregister-ScheduledTask -TaskName "EmbryoMatrix Image Sync"
```

## Keep the sync key private

The key can only list and download files (images, protocol documents, result spreadsheets); it cannot sign in or change anything. Anyone who has it can still download those files, though. If it leaks, change `IMAGE_SYNC_TOKEN` on the server, restart the tracker, and put the new key in `sync-config.json`.
