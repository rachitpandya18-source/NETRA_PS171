from __future__ import annotations

import base64
import binascii
import hashlib
import io
import re
from typing import Any, Iterable

from PIL import Image

from app.core.config import Settings


EMAIL_RE = re.compile(
    r'\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b',
    re.I,
)

PHONE_RE = re.compile(
    r'(?<!\d)(?:\+?91[\s-]?)?[6-9]\d{9}(?!\d)',
)

CARD_RE = re.compile(
    r'(?<!\d)(?:\d[ -]?){13,19}(?!\d)',
)

AADHAAR_RE = re.compile(
    r'(?<!\d)\d{4}[ -]?\d{4}[ -]?\d{4}(?!\d)',
)

PAN_RE = re.compile(
    r'\b[A-Z]{5}\d{4}[A-Z]\b',
    re.I,
)

UPI_RE = re.compile(
    r'(?<![\w.-])[A-Z0-9._-]{2,256}@[A-Z][A-Z0-9.-]{1,63}(?![\w.-])',
    re.I,
)

IFSC_RE = re.compile(
    r'\b[A-Z]{4}0[A-Z0-9]{6}\b',
    re.I,
)

SECRET_KEY_RE = re.compile(
    r'(api[_ -]?key|access[_ -]?token|password|secret|'
    r'authorization|bearer[_ -]?token)\s*[:=]\s*[^\s,]+',
    re.I,
)


class PrivacyViolation(ValueError):
    pass


def _strings(obj: Any, path: str = '') -> Iterable[tuple[str, str]]:
    """
    Recursively extract every string value from a nested request object.

    Returns:
        (JSON-like path, string value)
    """
    if isinstance(obj, str):
        yield path, obj

    elif isinstance(obj, dict):
        for key, value in obj.items():
            yield from _strings(value, f'{path}.{key}')

    elif isinstance(obj, (list, tuple)):
        for index, value in enumerate(obj):
            yield from _strings(value, f'{path}[{index}]')


def find_sensitive_literals(
    obj: Any,
    *,
    include_instruction: bool = False,
) -> list[dict[str, str]]:
    """
    Scan request content for raw sensitive values.

    This is intentionally performed on the backend so the server does
    not blindly trust client-provided privacy flags.
    """
    hits: list[dict[str, str]] = []

    for path, value in _strings(obj):

        # The user's natural-language instruction may legitimately contain
        # words such as "password" or "email". It should not automatically
        # be treated as a leaked secret unless it contains an actual value.
        if not include_instruction and (
            path.endswith('.instruction') or path == 'instruction'
        ):
            continue

        if EMAIL_RE.search(value):
            hits.append({
                'path': path,
                'kind': 'email',
            })

        if PHONE_RE.search(value):
            hits.append({
                'path': path,
                'kind': 'phone',
            })

        if AADHAAR_RE.search(value):
            hits.append({
                'path': path,
                'kind': 'aadhaar_like',
            })

        if PAN_RE.search(value):
            hits.append({
                'path': path,
                'kind': 'pan_like',
            })

        if CARD_RE.search(value):
            hits.append({
                'path': path,
                'kind': 'card_like',
            })

        if UPI_RE.search(value):
            hits.append({
                'path': path,
                'kind': 'upi_like',
            })

        if IFSC_RE.search(value):
            hits.append({
                'path': path,
                'kind': 'ifsc_like',
            })

        if SECRET_KEY_RE.search(value):
            hits.append({
                'path': path,
                'kind': 'secret_like',
            })

    # Remove duplicate path/type combinations.
    unique = {
        (item['path'], item['kind']): item
        for item in hits
    }

    return list(unique.values())


def assert_privacy_request(
    payload: Any,
    settings: Settings,
) -> None:
    """
    Backend privacy gate.

    The server independently scans the complete request payload instead
    of trusting client-provided privacy flags.
    """
    hits = find_sensitive_literals(
        payload,
        include_instruction=True,
    )

    if hits and settings.privacy_strict:
        kinds = sorted({
            item['kind']
            for item in hits
        })

        raise PrivacyViolation(
            'Privacy invariant violated: request contains a value '
            'matching a sensitive-data pattern. '
            'Send only redacted/sanitized context and local value '
            'references. Detected categories: '
            + ', '.join(kinds)
        )


def validate_sanitized_image(
    data_base64: str | None,
    mime_type: str,
    max_bytes: int,
) -> dict[str, Any]:
    """
    Validate the screenshot received by the backend.

    The image must:
    - contain valid base64
    - remain below the configured size limit
    - be a valid image
    - have readable dimensions
    """
    if not data_base64:
        return {
            'present': False,
            'verified': False,
            'width': None,
            'height': None,
            'bytes': 0,
            'sha256': None,
        }

    try:
        raw = base64.b64decode(
            data_base64,
            validate=True,
        )
    except (ValueError, binascii.Error) as exc:
        raise PrivacyViolation(
            'Screenshot payload is not valid base64'
        ) from exc

    if len(raw) > max_bytes:
        raise PrivacyViolation(
            f'Screenshot exceeds the {max_bytes} byte limit'
        )

    try:
        with Image.open(io.BytesIO(raw)) as img:
            img.verify()

        with Image.open(io.BytesIO(raw)) as img:
            width, height = img.size

    except Exception as exc:
        raise PrivacyViolation(
            'Sanitized screenshot is not a valid image'
        ) from exc

    digest = hashlib.sha256(raw).hexdigest()

    return {
        'present': True,
        'verified': True,
        'width': width,
        'height': height,
        'bytes': len(raw),
        'sha256': digest,
    }