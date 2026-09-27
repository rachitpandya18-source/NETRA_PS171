from __future__ import annotations

import re
from typing import Iterable

from app.models.schemas import Action, ActionType, PageNode, PageSnapshot, Perception


def _norm(text: str) -> str:
    return re.sub(r'\s+', ' ', text or '').strip().lower()


def _node_text(node: PageNode) -> str:
    return _norm(f'{node.role or ""} {node.name} {node.text}')


def _keywords(instruction: str) -> list[str]:
    stop = {'the', 'a', 'an', 'to', 'on', 'in', 'at', 'for', 'and', 'of', 'please', 'find', 'show', 'locate', 'where'}
    toks = re.findall(r'[a-z0-9]{2,}', _norm(instruction))
    return [t for t in toks if t not in stop]


def _score(node: PageNode, keys: Iterable[str], preferred_roles: set[str]) -> float:
    text = _node_text(node)
    score = 0.0
    for key in keys:
        if key in text:
            score += 1.0
            if key == _norm(node.name):
                score += 1.0
    if node.role in preferred_roles:
        score += 1.5
    if node.visible and not node.disabled:
        score += 0.4
    return score


def _best(nodes: list[PageNode], keys: list[str], roles: set[str], require_empty_text: bool = False) -> PageNode | None:
    candidates = [n for n in nodes if n.visible and not n.disabled]
    if require_empty_text:
        empty = [n for n in candidates if not (n.text or '').strip()]
        if empty:
            candidates = empty
    ranked = sorted(candidates, key=lambda n: _score(n, keys, roles), reverse=True)
    if not ranked:
        return None
    best = ranked[0]
    return best if _score(best, keys, roles) >= 1.4 else None


def plan(instruction: str, page: PageSnapshot, perception: Perception) -> tuple[Action, float, str]:
    text = _norm(instruction)
    keys = _keywords(instruction)

    # Navigation is explicit and local-safe.
    url_match = re.search(r'https?://[^\s]+', instruction)
    if url_match and any(w in text for w in ('open', 'go to', 'navigate', 'visit')):
        return Action(type=ActionType.navigate, url=url_match.group(0), confidence=0.97, reason='Explicit URL navigation request'), 0.97, 'deterministic'

    if any(w in text for w in ('scroll', 'page down', 'page up')):
        direction = 'up' if any(w in text for w in ('up', 'top')) else 'down'
        amount = 700 if 'page' in text else 500
        return Action(type=ActionType.scroll, direction=direction, amount=amount, confidence=0.92, reason='Explicit scroll instruction'), 0.92, 'deterministic'

    if any(w in text for w in ('wait', 'pause')):
        return Action(type=ActionType.wait, ms=1000, confidence=0.9, reason='Explicit wait instruction'), 0.9, 'deterministic'

    wants_type = any(w in text for w in ('type', 'enter', 'write', 'search for', 'fill'))
    wants_click = any(w in text for w in ('click', 'tap', 'press', 'open', 'select', 'find', 'locate', 'submit'))

    if wants_type:
        target = _best(page.nodes, keys, {'textbox', 'searchbox', 'combobox'}, require_empty_text=True)
        if target:
            # Values are intentionally not carried from the natural-language instruction.
            return Action(
                type=ActionType.type,
                ref=target.ref,
                value_ref='LOCAL_USER_VALUE',
                confidence=0.88,
                reason='Text entry requires a local secret/value reference; raw values stay on-device',
            ), 0.88, 'deterministic'

    if wants_click:
        target = _best(page.nodes, keys, {'button', 'link', 'menuitem', 'tab', 'checkbox', 'radio', 'option'})
        if target:
            return Action(type=ActionType.click, ref=target.ref, confidence=0.93, reason=f'Best semantic match: {target.role or "element"}'), 0.93, 'deterministic'

    # Perception fallback: use local detector refs/labels.
    if perception.ui_detections:
        dets = [d for d in perception.ui_detections if d.confidence >= 0.6]
        if dets:
            d = max(dets, key=lambda x: x.confidence)
            return Action(type=ActionType.click, ref=d.ref, confidence=min(0.78, d.confidence), reason=f'Perception fallback: {d.label}'), min(0.78, d.confidence), 'deterministic-perception'

    return Action(type=ActionType.no_op, confidence=0.15, reason='No safe matching action found'), 0.15, 'deterministic'
