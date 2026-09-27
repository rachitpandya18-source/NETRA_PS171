# NETRA — Judge-Ready Backend (PS 171)

This backend is designed for the actual NETRA prototype, not a throwaway test server.
It exposes a stable API contract for the browser-extension/frontend team and preserves
NETRA's privacy invariant:

> **Raw PII must never be accepted by or sent to the backend.**

The backend plans browser actions from sanitized semantic page context and local
perception. It can optionally send the sanitized screenshot/context to an
OpenAI-compatible VLM endpoint (for example, a Qwen-VL deployment). When the VLM is not
configured or fails, deterministic planning remains available so a judge demo does not
collapse because a model server is unavailable.

## Architecture

```text
Chrome/Edge Extension
        |
        | sanitized screenshot + sanitized page snapshot
        v
FastAPI /api/v1/agent/run
        |
        +--> privacy gate
        |
        +--> optional Qwen-VL / OpenAI-compatible planner
        |
        +--> deterministic fallback planner
        |
        +--> action safety validator
        |
        +--> structured action + trace
        v
Extension executes locally
        |
        +--> re-observe
        +--> call backend again
```

## What the backend does

- Strict request validation with Pydantic v2.
- Privacy gate that rejects payloads containing common raw PII/secret patterns.
- Accepts only `redacted=true` screenshots.
- Validates optional sanitized screenshot bytes and SHA-256.
- Plans click/type/scroll/navigate/wait actions.
- Never returns raw type values; type actions use `value_ref="LOCAL_USER_VALUE"`.
- Validates action references and roles before returning an action.
- Optional OpenAI-compatible multimodal VLM adapter.
- Deterministic fallback so demo mode is runnable with no GPU/model server.
- Redaction audit endpoint.
- Lightweight audit trail that stores metadata only; no request payloads.
- Swagger/OpenAPI at `/docs`.

## Run locally

### Windows PowerShell

```powershell
cd NETRA_backend_judge_ready
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
Copy-Item .env.example .env
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Open:

- http://127.0.0.1:8000/health
- http://127.0.0.1:8000/docs

### Linux/macOS

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

## Planner modes

`PLANNER_MODE=deterministic` is the safest no-model demo mode.

`PLANNER_MODE=hybrid` uses VLM first when `VLM_ENABLED=true`; otherwise it falls back
to deterministic planning. This is the recommended judge setting when a Qwen-VL server
is available.

`PLANNER_MODE=vlm` requires the VLM and fails closed if it cannot plan.

## VLM adapter

The adapter uses the OpenAI-compatible `/chat/completions` interface. Configure:

```env
VLM_ENABLED=true
VLM_BASE_URL=http://localhost:11434/v1
VLM_API_KEY=local
VLM_MODEL=qwen-vl
PLANNER_MODE=hybrid
ALLOW_FALLBACK=true
```

The server receives only the sanitized screenshot and sanitized page snapshot. For a
judge build, keep the VLM model/process on the same machine whenever practical.

## Canonical request

`POST /api/v1/agent/run`

```json
{
  "instruction": "Find the Learn more link",
  "page": {
    "url": "https://example.com/",
    "title": "Example Domain",
    "nodes": [
      {
        "ref": "e0",
        "role": "link",
        "name": "Learn more",
        "text": "Learn more",
        "rect": {"x": 30, "y": 210, "width": 92, "height": 22},
        "disabled": false,
        "visible": true
      }
    ]
  },
  "screenshot": {
    "redacted": true,
    "mime_type": "image/png",
    "data_base64": null
  },
  "pii": {
    "redaction_count": 0,
    "findings": [],
    "raw_values_sent": false,
    "verified_local": true,
    "leakage_check_passed": true
  },
  "perception": {
    "ui_detections": [],
    "ocr_text_redacted": [],
    "source": "local",
    "model": "local-perception"
  },
  "execute_locally": false
}
```

Typical response:

```json
{
  "ok": true,
  "planner": "deterministic",
  "fallback_used": false,
  "action": {
    "type": "click",
    "ref": "e0",
    "confidence": 0.93,
    "reason": "Best semantic match: link"
  },
  "sanitized": true,
  "raw_pii_received": false,
  "next_step": "execute_locally_then_reobserve",
  "closed_loop": true,
  "requires_reobserve": true
}
```

## Backward compatibility

The current prototype extension calls `POST /plan` with the older request shape.
That route is retained as a compatibility alias and is normalized into the same
validated backend pipeline.

## Frontend handoff

The frontend/browser-extension team should use these canonical endpoints:

- `GET /health`
- `GET /api/v1/config`
- `POST /api/v1/agent/run`
- `POST /api/v1/plan`
- `POST /api/v1/action/validate`
- `POST /api/v1/redaction/audit`

They should **not** send:

- raw OCR text containing PII
- raw PII values
- user credentials
- unredacted screenshots
- raw password/email/phone/card values in type actions

For type actions, the backend returns `value_ref="LOCAL_USER_VALUE"`; the local
extension is responsible for resolving that reference from a local secret store,
autofill helper, or user-approved input.

## Judge demo path

1. Start this backend.
2. Verify `/health`.
3. Load the extension/frontend.
4. Use an example page containing buttons, links, and text inputs.
5. The local perception layer prepares the sanitized page snapshot and screenshot.
6. `/api/v1/agent/run` returns a structured action.
7. Extension executes the action locally.
8. Extension re-observes the page and calls the endpoint again.
9. `/api/v1/audit` can show non-sensitive execution metadata.

## Important prototype boundary

The backend intentionally does not execute browser actions itself. Browser actions remain
local to the extension so browser permissions, user confirmation, secret resolution, and
page interaction remain on-device.

Also, a stock COCO YOLO model is not a final browser-UI detector. The NETRA browser
perception layer still needs its RICO/Screen Annotation fine-tuning/export work for
strong UI detection. This backend is already designed to consume those future local
perception outputs without changing the frontend API contract.
