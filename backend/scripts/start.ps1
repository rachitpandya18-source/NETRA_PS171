$ErrorActionPreference = 'Stop'

if (-not (Test-Path .venv)) {
  py -m venv .venv
}

.\.venv\Scripts\python.exe -m pip install -r requirements.txt
if (-not (Test-Path .env)) {
  Copy-Item .env.example .env
}

Write-Host "Starting NETRA backend on http://127.0.0.1:8000"
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000
