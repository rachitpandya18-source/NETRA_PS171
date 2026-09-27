import json
from pathlib import Path

import httpx

BASE = 'http://127.0.0.1:8000'
body = json.loads(Path(__file__).resolve().parents[1].joinpath('examples/request_example.json').read_text())

r = httpx.get(f'{BASE}/health', timeout=5)
r.raise_for_status()
print('HEALTH:', r.json())

r = httpx.post(f'{BASE}/api/v1/agent/run', json=body, timeout=20)
r.raise_for_status()
print(json.dumps(r.json(), indent=2))
