# NETRA Frontend Demo — Presentation Build

## What this demonstrates
- Chrome MV3 Side Panel Command Center
- Actual fine-tuned NETRA YOLO11n ONNX model
- Local screenshot capture
- Local UI detection
- Local regex-based PII detection for the demo
- Local screenshot redaction
- Sanitized AXTree/page snapshot
- Backend V3 `/api/v1/plan_action`
- Safe local CLICK/TYPE execution using the local token vault

## Important
This presentation build does NOT claim that GLiNER/Tesseract are wired into this exact demo. The PII demo layer uses deterministic local patterns so the privacy boundary can be demonstrated reliably.

## Run
1. Install Node.js 20+.
2. In this folder:
   npm install
   npm run build
3. Start backend V3 separately on http://localhost:8000.
4. Open Chrome -> chrome://extensions -> Developer mode -> Load unpacked.
5. Select `dist/`.
6. Open a normal http/https webpage, reload it, then click the NETRA extension icon.
7. Enter the task and press `PERCEIVE → REDACT → PLAN`.

For a reliable presentation, use a controlled demo webpage containing an email input and a clearly named button.
