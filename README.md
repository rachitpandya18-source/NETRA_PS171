# NETRA Integrated Rebuild Baseline — Contact Us Ready

This package starts from the original NETRA frontend demo, original judge-ready backend, and the combined V2 YOLO dataset.

## What is included
- Original browser-extension demo architecture (module-based `onnxruntime-web`).
- Vite build hook that copies ONNX Runtime Web `.mjs`/`.wasm` runtime assets into `dist/assets/` using stable filenames, fixing Chrome extension dynamic-import failures.
- ONNX model copied into `dist/models/` during build.
- Local Profile Vault UI: First Name, Last Name, Email, Phone.
- Profile values stored with `chrome.storage.local` only.
- Content script resolves TYPE actions from the local vault; raw profile values are not sent to the backend.
- Screenshot redaction uses viewport-to-capture scaling.
- Frontend uses the backend's canonical `/api/v1/plan` contract.
- Deterministic backend planner advances through empty text fields and recognizes `submit` as a click intent.
- Combined V2 YOLO dataset retained under `ml/dataset/`.

## Build
From `frontend/`:
```powershell
npm install
npm run build
```
Load `frontend/dist` as the unpacked Chrome extension.

The build copies ORT runtime assets from `node_modules/onnxruntime-web/dist/` into `dist/assets/` and copies the model into `dist/models/`.

## Backend
From `backend/`:
```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
py -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

## Contact Us flow
1. Open the NETRA side panel.
2. Enter First Name / Last Name / Email / Phone in LOCAL PROFILE VAULT.
3. Click `SAVE PROFILE LOCALLY`.
4. Open the target Contact Us webpage and reload it after loading the extension.
5. Use the task instruction:
   `Fill the Contact Us form with the saved profile details and submit the form.`
6. Run the perception/planning action. The planner and local executor use only token references; the actual profile values stay in the extension vault.

## Important
Do not copy files from the old broken `NETRA_FINAL_PROTOTYPE_*` folders into this project. This is the clean rebuild baseline.
