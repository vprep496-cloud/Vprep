# V-Prep Windows Transfer Setup

Use these steps after unzipping the project on a Windows laptop.

## One command setup

Open PowerShell in the unzipped `vprep` folder and run:

```powershell
powershell -ExecutionPolicy Bypass -File .\setup-windows.ps1 -InstallPrerequisites
```

If Windows installs Python, Node, MongoDB, Ollama, or Tesseract, close PowerShell,
open it again in the same `vprep` folder, and rerun:

```powershell
powershell -ExecutionPolicy Bypass -File .\setup-windows.ps1
```

## Start everything

After setup finishes, run:

```powershell
powershell -ExecutionPolicy Bypass -File .\start-windows.ps1
```

This opens separate terminals for:

- FastAPI backend at `http://localhost:8000`
- Admin portal at `http://localhost:3000`
- Expo mobile app

## Files that must come from the old laptop

These files contain real project credentials/config and cannot be regenerated
perfectly by the script:

```text
backend\.env
backend\firebase-service-account.json
admin\.env.local
mobile\.env
mobile\google-services.json
```

The setup script creates env files from examples if they are missing, but real
Firebase/Google sign-in needs the original credential files or newly downloaded
ones from the same Firebase project.

`backend\firebase-service-account.json` is required. The backend will not start
without it.

## Move existing MongoDB data

If you need the same users, sessions, assessments, and results on the new
laptop, export the database on the old laptop before zipping:

```bash
mongodump --db vprep --out ./mongo-backup
```

Move the `mongo-backup` folder with the project, then restore it on Windows:

```powershell
mongorestore --db vprep .\mongo-backup\vprep
```

## Use from Codex or Claude on Windows

Paste this prompt after opening the unzipped project:

```text
You are inside the V-PREP project on Windows. Go into the vprep folder and run:

powershell -ExecutionPolicy Bypass -File .\setup-windows.ps1 -InstallPrerequisites

If that installs system software, ask me to reopen PowerShell, then rerun:

powershell -ExecutionPolicy Bypass -File .\setup-windows.ps1

After setup completes, start the app with:

powershell -ExecutionPolicy Bypass -File .\start-windows.ps1

Do not change app source code unless a real setup error requires it.
```

## Optional demo data

To seed demo dashboard data too:

```powershell
powershell -ExecutionPolicy Bypass -File .\setup-windows.ps1 -SeedDemoData
```
