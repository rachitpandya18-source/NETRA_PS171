from __future__ import annotations

import secrets
import time
from collections import deque
from typing import Any
from uuid import uuid4

from app.core.config import Settings
from app.core.privacy import PrivacyViolation, assert_privacy_request, validate_sanitized_image
from app.models.schemas import (
    Action,
    ActionValidationRequest,
    AgentRunRequest,
    AgentRunResponse,
    PlanRequest,
    PlanResponse,
    RedactionAuditRequest,
    RedactionAuditResponse,
)
from app.services.action_validator import validate_action
from app.services.deterministic_planner import plan as deterministic_plan
from app.services.vlm_planner import OpenAICompatibleVLMPlanner, VLMPlannerError


class AuditLog:
    def __init__(self, max_items: int = 500):
        self.items = deque(maxlen=max_items)

    def add(self, event: dict[str, Any]) -> None:
        self.items.append(event)

    def latest(self) -> list[dict[str, Any]]:
        return list(self.items)


class AgentService:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.audit = AuditLog(settings.audit_keep)
        self.vlm = OpenAICompatibleVLMPlanner(settings)

    def _ids(self, request_id: str | None, session_id: str | None) -> tuple[str, str]:
        rid = request_id or str(uuid4())
        sid = session_id or f'netra-{secrets.token_hex(6)}'
        return rid, sid

    def _prepare(self, req: PlanRequest) -> tuple[str, str, dict[str, Any]]:
        rid, sid = self._ids(req.request_id, req.session_id)
        if len(req.page.nodes) > self.settings.max_nodes:
            raise PrivacyViolation('Page snapshot contains too many nodes')
        if len(req.instruction) > self.settings.max_instruction_chars:
            raise PrivacyViolation('Instruction is too long')
        payload = req.model_dump()
        assert_privacy_request(payload, self.settings)
        image_info = validate_sanitized_image(req.screenshot.data_base64, req.screenshot.mime_type, self.settings.max_image_bytes)
        if req.screenshot.sha256 and image_info.get('sha256') and req.screenshot.sha256 != image_info['sha256']:
            raise PrivacyViolation('Screenshot sha256 does not match received bytes')
        if req.pii.raw_values_sent:
            raise PrivacyViolation('raw_values_sent must be false')
        if not req.screenshot.redacted:
            raise PrivacyViolation('Only redacted screenshots are accepted')
        return rid, sid, image_info

    async def plan(self, req: PlanRequest) -> PlanResponse:
        started = time.perf_counter()
        rid, sid, image_info = self._prepare(req)
        trace: list[dict[str, Any]] = [
            {'stage': 'privacy_gate', 'ok': True},
            {'stage': 'sanitized_image', 'present': image_info['present'], 'verified': image_info['verified']},
        ]
        fallback_used = False
        planner_name = 'deterministic'

        action: Action
        confidence: float

        use_vlm = self.settings.vlm_enabled and self.settings.planner_mode in {'hybrid', 'vlm'}
        if use_vlm:
            try:
                action, planner_name = await self.vlm.plan(
                    req.instruction,
                    req.page,
                    req.perception,
                    req.screenshot.data_base64,
                    req.screenshot.mime_type,
                )
                confidence = action.confidence
                trace.append({'stage': 'vlm', 'ok': True, 'planner': planner_name})
            except VLMPlannerError as exc:
                trace.append({'stage': 'vlm', 'ok': False, 'error': str(exc)[:300]})
                if not self.settings.allow_fallback or self.settings.planner_mode == 'vlm':
                    raise
                action, confidence, planner_name = deterministic_plan(req.instruction, req.page, req.perception)
                fallback_used = True
                trace.append({'stage': 'fallback', 'planner': planner_name})
        else:
            action, confidence, planner_name = deterministic_plan(req.instruction, req.page, req.perception)
            trace.append({'stage': 'deterministic', 'planner': planner_name})

        validation = validate_action(action, req.page)
        trace.append({'stage': 'action_validation', 'valid': validation.valid, 'reasons': validation.reasons})
        if not validation.valid:
            action = Action(type='no_op', confidence=0.05, reason='Generated action failed safety validation')
            confidence = action.confidence
            fallback_used = True

        elapsed_ms = round((time.perf_counter() - started) * 1000, 2)
        trace.append({'stage': 'complete', 'latency_ms': elapsed_ms})

        privacy = {
            'raw_pii_received': False,
            'screenshot_redacted': req.screenshot.redacted,
            'local_redaction_count': req.pii.redaction_count,
            'local_leakage_check_passed': req.pii.leakage_check_passed,
        }
        self.audit.add({
            'request_id': rid,
            'session_id': sid,
            'planner': planner_name,
            'fallback_used': fallback_used,
            'raw_pii_received': False,
            'latency_ms': elapsed_ms,
        })

        return PlanResponse(
            ok=True,
            request_id=rid,
            session_id=sid,
            planner=planner_name,
            fallback_used=fallback_used,
            action=action,
            sanitized=True,
            raw_pii_received=False,
            privacy=privacy,
            confidence=confidence,
            next_step='execute_locally_then_reobserve',
            trace=trace,
        )

    async def run(self, req: AgentRunRequest) -> AgentRunResponse:
        response = await self.plan(req)
        return AgentRunResponse(**response.model_dump(), closed_loop=True, requires_reobserve=True)

    def redaction_audit(self, req: RedactionAuditRequest) -> RedactionAuditResponse:
        reasons: list[str] = []
        try:
            image_info = validate_sanitized_image(req.screenshot.data_base64, req.screenshot.mime_type, self.settings.max_image_bytes)
            image_verified = image_info['verified'] or not image_info['present']
        except PrivacyViolation as exc:
            image_verified = False
            reasons.append(str(exc))
        metadata_verified = req.screenshot.redacted and not req.pii.raw_values_sent and req.pii.verified_local
        if not metadata_verified:
            reasons.append('Local redaction metadata is not fully verified')
        privacy_invariant = image_verified and metadata_verified
        if not req.pii.leakage_check_passed:
            reasons.append('Leakage check was not marked as passed')
            privacy_invariant = False
        return RedactionAuditResponse(
            valid=privacy_invariant,
            reasons=reasons,
            image_verified=image_verified,
            metadata_verified=metadata_verified,
            privacy_invariant=privacy_invariant,
        )

    def get_audit(self) -> list[dict[str, Any]]:
        return self.audit.latest()
