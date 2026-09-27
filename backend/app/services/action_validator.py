from __future__ import annotations

import ipaddress
from urllib.parse import urlparse

from app.models.schemas import Action, ActionType, ActionValidationResponse, PageSnapshot


def _find_ref(page: PageSnapshot, ref: str | None):
    if not ref:
        return None
    return next((n for n in page.nodes if n.ref == ref), None)


def validate_action(action: Action, page: PageSnapshot) -> ActionValidationResponse:
    reasons: list[str] = []

    if action.type in {ActionType.click, ActionType.type}:
        node = _find_ref(page, action.ref)
        if node is None:
            reasons.append('Referenced node does not exist in the current snapshot')
        else:
            if not node.visible or node.disabled:
                reasons.append('Referenced node is not currently actionable')
            if action.type == ActionType.click and node.role not in {'button', 'link', 'menuitem', 'tab', 'checkbox', 'radio', 'option', None}:
                reasons.append(f'Node role {node.role!r} is not a normal click target')
            if action.type == ActionType.type and node.role not in {'textbox', 'searchbox', 'combobox'}:
                reasons.append(f'Node role {node.role!r} is not a text-entry target')
            if action.value is not None:
                reasons.append('Raw type values are not permitted from the server; use value_ref for local resolution')

    if action.type == ActionType.scroll:
        if not action.direction or action.amount is None:
            reasons.append('Scroll action requires direction and amount')

    if action.type == ActionType.navigate:
        if not action.url:
            reasons.append('Navigate action requires a URL')
        else:
            parsed = urlparse(action.url)
            if parsed.scheme not in {'http', 'https'} or not parsed.netloc:
                reasons.append('Navigate URL must be an absolute http(s) URL')
            try:
                if parsed.hostname:
                    ipaddress.ip_address(parsed.hostname)
                    reasons.append('Direct IP navigation is disabled by default')
            except ValueError:
                pass

    if action.type == ActionType.wait and action.ms is None:
        reasons.append('Wait action requires ms')

    if action.type == ActionType.no_op:
        # no-op is valid and safe
        pass

    return ActionValidationResponse(valid=not reasons, reasons=reasons, normalized_action=action if not reasons else None)
