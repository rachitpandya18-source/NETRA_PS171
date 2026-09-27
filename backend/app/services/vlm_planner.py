from __future__ import annotations

import base64
import json
import re
from typing import Any

import httpx

from app.core.config import Settings
from app.models.schemas import Action, ActionType, PageSnapshot, Perception


class VLMPlannerError(RuntimeError):
    pass


SYSTEM_PROMPT = '''You are NETRA, a privacy-first browser agent planner.
You receive only sanitized browser context. Never ask for, infer, or output raw personal data.
Return exactly one JSON object with this shape:
{"type":"click|type|scroll|navigate|wait|no_op","ref":null,"value":null,"value_ref":null,"direction":null,"amount":null,"url":null,"ms":null,"reason":"...","confidence":0.0}
For type actions always use value_ref="LOCAL_USER_VALUE" and never put a raw user value in value.
Only reference refs that exist in the supplied page snapshot.
'''


def _extract_json(text: str) -> dict[str, Any]:
    text = text.strip()
    try:
        value = json.loads(text)
        if isinstance(value, dict):
            return value
    except json.JSONDecodeError:
        pass
    match = re.search(r'\{.*\}', text, re.S)
    if not match:
        raise VLMPlannerError('VLM did not return a JSON object')
    try:
        value = json.loads(match.group(0))
    except json.JSONDecodeError as exc:
        raise VLMPlannerError('VLM JSON could not be parsed') from exc
    if not isinstance(value, dict):
        raise VLMPlannerError('VLM JSON response was not an object')
    return value


class OpenAICompatibleVLMPlanner:
    def __init__(self, settings: Settings):
        self.settings = settings

    async def plan(self, instruction: str, page: PageSnapshot, perception: Perception, image_base64: str | None, mime_type: str) -> tuple[Action, str]:
        content: list[dict[str, Any]] = [
            {
                'type': 'text',
                'text': (
                    f'Instruction: {instruction}\n'
                    f'Sanitized page: {page.model_dump_json()}\n'
                    f'Local perception: {perception.model_dump_json()}\n'
                ),
            }
        ]
        if image_base64:
            content.append({'type': 'image_url', 'image_url': {'url': f'data:{mime_type};base64,{image_base64}'}})

        payload = {
            'model': self.settings.vlm_model,
            'messages': [
                {'role': 'system', 'content': SYSTEM_PROMPT},
                {'role': 'user', 'content': content},
            ],
            'temperature': 0,
        }

        headers = {'Authorization': f'Bearer {self.settings.vlm_api_key}'} if self.settings.vlm_api_key else {}
        url = self.settings.vlm_base_url.rstrip('/') + '/chat/completions'
        try:
            async with httpx.AsyncClient(timeout=self.settings.vlm_timeout_s) as client:
                response = await client.post(url, json=payload, headers=headers)
                response.raise_for_status()
                data = response.json()
        except Exception as exc:
            raise VLMPlannerError(f'VLM request failed: {exc}') from exc

        try:
            content_text = data['choices'][0]['message']['content']
            if isinstance(content_text, list):
                content_text = ''.join(str(x.get('text', '')) for x in content_text if isinstance(x, dict))
        except Exception as exc:
            raise VLMPlannerError('VLM response did not contain choices[0].message.content') from exc

        action_data = _extract_json(str(content_text))
        try:
            action = Action(**action_data)
        except Exception as exc:
            raise VLMPlannerError(f'VLM action schema validation failed: {exc}') from exc
        return action, 'openai-compatible-vlm'
