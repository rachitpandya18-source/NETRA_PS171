from __future__ import annotations

import base64
import binascii
import hashlib
import io
import re
from typing import Any, Iterable

from PIL import Image

from app.core.config import Settings


EMAIL_RE = re.compile(r'\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b', re.I)
PHONE_RE = re.compile(r'(?<!\d)(?:\+?91[\s-]?)?[6-9]\d{9}(?!\d)')
CARD_RE = re.compile(r'(?<!\d)(?:\d[ -]?){13,19}(?!\d)')
AADHAAR_RE = re.compile(r'(?<!\d)\d{4}[ -]?\d{4}[ -]?\d{4}(?!\d)')
PAN_RE = re.compile(r'\b[A-Z]{5}\d{4}[A-Z]\b', re.I)
SECRET_KEY_RE = re.compile(r'(api[_ -]?key|access[_ -]?token|password|secret)\s*[:=]\s*[^\s,]+', re.I)


class PrivacyViolation(ValueError):
    pass


def _strings(obj: Any, path: str = '') -> Iterable[tuple[str, str]]:
    if isinstance(obj, str):
        yield path, obj
    elif isinstance(obj, dict):
        for k, v in obj.items():
            yield from _strings(v, f'{path}.{k}')
    elif isinstance(obj, (list, tuple)):
        for i, v in enumerate(obj):
            yield from _strings(v, f'{path}[{i}]')


def find_sensitive_literals(obj: Any, *, include_instruction: bool = False) -> list[dict[str, str]]:
    hits: list[dict[str, str]] = []
    for path, value in _strings(obj):
        if not include_instruction and (path.endswith('.instruction') or path == 'instruction'):
            continue
        if EMAIL_RE.search(value):
            hits.append({'path': path, 'kind': 'email'})
        if PHONE_RE.search(value):
            hits.append({'path': path, 'kind': 'phone'})
        if AADHAAR_RE.search(value):
            hits.append({'path': path, 'kind': 'aadhaar_like'})
        if PAN_RE.search(value):
            hits.append({'path': path, 'kind': 'pan_like'})
        if CARD_RE.search(value):
            hits.append({'path': path, 'kind': 'card_like'})
        if SECRET_KEY_RE.search(value):
            hits.append({'path': path, 'kind': 'secret_like'})
    # deterministic unique entries
    unique = {(x['path'], x['kind']): x for x in hits}
    return list(unique.values())


def assert_privacy_request(payload: Any, settings: Settings) -> None:
    hits = find_sensitive_literals(payload, include_instruction=True)
    if hits and settings.privacy_strict:
        # Instruction is checked too: the server should never be given a literal secret/PII value.
        raise PrivacyViolation(
            'Privacy invariant violated: request contains a value matching a sensitive-data pattern. '
            'Send only redacted/sanitized context and local value references.'
        )


def validate_sanitized_image(data_base64: str | None, mime_type: str, max_bytes: int) -> dict[str, Any]:
    if not data_base64:
        return {'present': False, 'verified': False, 'width': None, 'height': None, 'bytes': 0, 'sha256': None}
    try:
        raw = base64.b64decode(data_base64, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise PrivacyViolation('Screenshot payload is not valid base64') from exc
    if len(raw) > max_bytes:
        raise PrivacyViolation(f'Screenshot exceeds the {max_bytes} byte limit')
    try:
        with Image.open(io.BytesIO(raw)) as img:
            img.verify()
        with Image.open(io.BytesIO(raw)) as img:
            width, height = img.size
    except Exception as exc:
        raise PrivacyViolation('Sanitized screenshot is not a valid image') from exc
    digest = hashlib.sha256(raw).hexdigest()
    return {'present': True, 'verified': True, 'width': width, 'height': height, 'bytes': len(raw), 'sha256': digest}
