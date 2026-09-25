# EmbryoMatrix file sync

Automatically copies every embryo image, protocol document, and uploaded
result spreadsheet from EmbryoMatrix onto this PC's local storage — a second,
independent copy that lives off the server. You set it up once; after that it
runs by itself in the background every few minutes, including after the PC
restarts. Nobody needs to run anything day to day.

Files are saved like this:

```
D:\EmbryoImages\
  HYP0000004527\          <- case ID
    DJ1\                  <- embryo
      1_Screenshot.png
    General _ patient\    <- images not linked to a specific embryo
  _Protocols\
    3_SOP-PGTA-v2.pdf
  _ResultFiles\
    RUN21_Analysis_Run21_PGT-MANIPAL.xlsx
```

Local copies are never deleted, even if the original is removed in the tracker.

## Requirements

- A Windows PC with enough free disk space (Windows PowerShell is built in, so nothing needs installing).
- Network access to the tracker's address (LAN or internet, whichever applies). The PC only makes outgoing requests, so no firewall or router changes are needed.

## One-time setup

1. Copy this `image_sync` folder to the storage PC, e.g. `C:\EmbryoMatrixSync`.
2. In that folder, copy `sync-config.example.json` to `sync-config.json` and fill it in:
   - `ServerUrl`: the tracker's address, e.g. `http://192.168.1.50:8001` or `https://tracker.yourcompany.com`
   - `SyncKey`: the `IMAGE_SYNC_TOKEN` value from the tracker server's `.env`. Ask whoever runs the server for it. (Same key covers images, protocols, and result files — it only ever grants read/download access.)
   - `Destination`: where to save everything, e.g. `D:\\EmbryoImages` (use double backslashes)
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

If you already had this set up for images only, just replace `sync-images.ps1` with the new version and leave everything else (config, scheduled task) as-is — the next scheduled run starts picking up protocols and result files automatically, with no reinstall needed.

## Checking it's working

- `sync.log` in the folder records every file saved and any errors.
- `sync-state.json` / `sync-state-protocols.json` / `sync-state-resultfiles.json` each record how far that category has synced. Delete one to re-check its category from the start; files already saved locally are skipped, not re-downloaded.

## Turning it off

In an Administrator PowerShell:

```
Unregister-ScheduledTask -TaskName "EmbryoMatrix Image Sync"
```

## Keep the sync key private

The key can only list and download files (images, protocol documents, result spreadsheets); it cannot sign in or change anything. Anyone who has it can still download those files, though. If it leaks, change `IMAGE_SYNC_TOKEN` on the server, restart the tracker, and put the new key in `sync-config.json`.
