# EmbryoMatrix image sync

Automatically copies every embryo image uploaded in EmbryoMatrix onto this PC's
local storage. You set it up once; after that it runs by itself in the
background every few minutes, including after the PC restarts. Nobody needs to
run anything day to day.

Images are saved like this:

```
D:\EmbryoImages\
  HYP0000004527\          <- case ID
    DJ1\                  <- embryo
      1_Screenshot.png
    General _ patient\    <- images not linked to a specific embryo
```

Local copies are never deleted, even if an image is removed in the tracker.

## Requirements

- A Windows PC with enough free disk space (Windows PowerShell is built in, so nothing needs installing).
- Internet access to the tracker's address. The PC only makes outgoing requests, so no firewall or router changes are needed.

## One-time setup

1. Copy this `image_sync` folder to the storage PC, e.g. `C:\EmbryoMatrixSync`.
2. In that folder, copy `sync-config.example.json` to `sync-config.json` and fill it in:
   - `ServerUrl`: the tracker's address, e.g. `https://tracker.yourcompany.com`
   - `SyncKey`: the `IMAGE_SYNC_TOKEN` value from the tracker server's `.env`. Ask whoever runs the server for it.
   - `Destination`: where to save images, e.g. `D:\\EmbryoImages` (use double backslashes)
   - `IntervalMinutes`: how often to check for new images (5 is fine)
3. Test it once. Open PowerShell in the folder and run:
   ```
   powershell -ExecutionPolicy Bypass -File sync-images.ps1 -Once
   ```
   You should see "Found N new image(s)" and the files should appear in the destination.
4. Turn on automatic syncing. Open PowerShell **as Administrator** in the folder and run:
   ```
   powershell -ExecutionPolicy Bypass -File install-sync-task.ps1
   ```

That's it. It now runs every few minutes in the background as a Windows scheduled task named **EmbryoMatrix Image Sync**, whether or not anyone is logged in.

## Checking it's working

- `sync.log` in the folder records every image saved and any errors.
- `sync-state.json` records the last image downloaded. Delete it to re-check every image; files that are already saved are skipped, not downloaded again.

## Turning it off

In an Administrator PowerShell:

```
Unregister-ScheduledTask -TaskName "EmbryoMatrix Image Sync"
```

## Keep the sync key private

The key can only list and download images; it cannot sign in or change anything. Anyone who has it can still download embryo images, though. If it leaks, change `IMAGE_SYNC_TOKEN` on the server, restart the tracker, and put the new key in `sync-config.json`.
