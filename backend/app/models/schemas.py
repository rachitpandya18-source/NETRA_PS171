from __future__ import annotations

from enum import Enum
from typing import Any, Dict, List, Literal, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, field_validator


class ActionType(str, Enum):
    click = 'click'
    type = 'type'
    scroll = 'scroll'
    navigate = 'navigate'
    wait = 'wait'
    no_op = 'no_op'


class Rect(BaseModel):
    model_config = ConfigDict(extra='ignore')
    x: float
    y: float
    width: float
    height: float


class PageNode(BaseModel):
    model_config = ConfigDict(extra='ignore')
    ref: str = Field(min_length=1, max_length=64)
    role: Optional[str] = Field(default=None, max_length=64)
    name: str = Field(default='', max_length=500)
    text: str = Field(default='', max_length=500)
    rect: Rect
    disabled: bool = False
    visible: bool = True


class PageSnapshot(BaseModel):
    model_config = ConfigDict(extra='ignore')
    url: str = Field(default='', max_length=2048)
    title: str = Field(default='', max_length=500)
    nodes: List[PageNode] = Field(default_factory=list, max_length=3000)


class SanitizedScreenshot(BaseModel):
    model_config = ConfigDict(extra='ignore')
    redacted: Literal[True]
    mime_type: Literal['image/png', 'image/jpeg', 'image/webp'] = 'image/png'
    data_base64: Optional[str] = None
    width: Optional[int] = Field(default=None, ge=1, le=10000)
    height: Optional[int] = Field(default=None, ge=1, le=10000)
    sha256: Optional[str] = Field(default=None, min_length=64, max_length=64)


class RedactionBox(BaseModel):
    model_config = ConfigDict(extra='ignore')
    entity_type: str = Field(min_length=1, max_length=64)
    confidence: float = Field(ge=0, le=1)
    box: Rect


class PrivacySummary(BaseModel):
    model_config = ConfigDict(extra='ignore')
    redaction_count: int = Field(default=0, ge=0)
    findings: List[RedactionBox] = Field(default_factory=list, max_length=1000)
    raw_values_sent: bool = False
    verified_local: bool = False
    leakage_check_passed: bool = False

    @field_validator('raw_values_sent')
    @classmethod
    def raw_values_must_be_false(cls, v: bool) -> bool:
        if v:
            raise ValueError('raw_values_sent must be false for NETRA privacy invariant')
        return v


class Detection(BaseModel):
    model_config = ConfigDict(extra='ignore')
    label: str = Field(min_length=1, max_length=128)
    confidence: float = Field(ge=0, le=1)
    box: Optional[Rect] = None
    ref: Optional[str] = None


class Perception(BaseModel):
    model_config = ConfigDict(extra='ignore')
    ui_detections: List[Detection] = Field(default_factory=list, max_length=2000)
    ocr_text_redacted: List[str] = Field(default_factory=list, max_length=2000)
    source: str = 'local'
    model: Optional[str] = None


class Action(BaseModel):
    model_config = ConfigDict(extra='ignore')
    type: ActionType
    ref: Optional[str] = None
    value: Optional[str] = None
    value_ref: Optional[str] = None
    direction: Optional[Literal['up', 'down', 'left', 'right']] = None
    amount: Optional[float] = Field(default=None, ge=0, le=100000)
    url: Optional[str] = None
    ms: Optional[int] = Field(default=None, ge=0, le=30000)
    reason: Optional[str] = Field(default=None, max_length=500)
    confidence: float = Field(default=0.8, ge=0, le=1)


class PlanRequest(BaseModel):
    model_config = ConfigDict(extra='ignore')
    instruction: str = Field(min_length=1, max_length=1000)
    page: PageSnapshot
    screenshot: SanitizedScreenshot
    pii: PrivacySummary
    perception: Perception = Field(default_factory=Perception)
    session_id: Optional[str] = Field(default=None, max_length=128)
    request_id: Optional[str] = Field(default=None, max_length=128)


class LegacyPlanRequest(BaseModel):
    model_config = ConfigDict(extra='ignore')
    instruction: str = Field(min_length=1, max_length=1000)
    page: Dict[str, Any]
    screenshot: Dict[str, Any]
    pii: Dict[str, Any]
    perception: Dict[str, Any] = Field(default_factory=dict)


class PlanResponse(BaseModel):
    ok: bool
    request_id: str
    session_id: str
    planner: str
    fallback_used: bool
    action: Action
    sanitized: bool = True
    raw_pii_received: bool = False
    privacy: Dict[str, Any]
    confidence: float
    next_step: str
    trace: List[Dict[str, Any]] = Field(default_factory=list)


class AgentRunRequest(PlanRequest):
    execute_locally: bool = False


class AgentRunResponse(PlanResponse):
    closed_loop: bool = True
    requires_reobserve: bool = True


class ActionValidationRequest(BaseModel):
    model_config = ConfigDict(extra='ignore')
    action: Action
    page: PageSnapshot


class ActionValidationResponse(BaseModel):
    valid: bool
    reasons: List[str] = Field(default_factory=list)
    normalized_action: Optional[Action] = None


class RedactionAuditRequest(BaseModel):
    model_config = ConfigDict(extra='ignore')
    screenshot: SanitizedScreenshot
    pii: PrivacySummary
    perception: Perception = Field(default_factory=Perception)


class RedactionAuditResponse(BaseModel):
    valid: bool
    reasons: List[str]
    image_verified: bool
    metadata_verified: bool
    privacy_invariant: bool


class HealthResponse(BaseModel):
    ok: bool
    service: str
    version: str
    planner_mode: str
    vlm_enabled: bool
    privacy_invariant: str
