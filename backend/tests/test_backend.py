from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def payload():
    return {
        'instruction': 'Find the Learn more link',
        'page': {
            'url': 'https://example.com/',
            'title': 'Example Domain',
            'nodes': [
                {
                    'ref': 'e0',
                    'role': 'link',
                    'name': 'Learn more',
                    'text': 'Learn more',
                    'rect': {'x': 10, 'y': 10, 'width': 100, 'height': 20},
                    'disabled': False,
                    'visible': True,
                }
            ],
        },
        'screenshot': {'redacted': True, 'mime_type': 'image/png', 'data_base64': None},
        'pii': {
            'redaction_count': 0,
            'findings': [],
            'raw_values_sent': False,
            'verified_local': True,
            'leakage_check_passed': True,
        },
        'perception': {'ui_detections': [], 'ocr_text_redacted': [], 'source': 'local', 'model': 'test'},
    }


def test_health():
    response = client.get('/health')
    assert response.status_code == 200
    assert response.json()['ok'] is True


def test_plan_click():
    response = client.post('/api/v1/plan', json=payload())
    assert response.status_code == 200
    data = response.json()
    assert data['action']['type'] == 'click'
    assert data['action']['ref'] == 'e0'
    assert data['raw_pii_received'] is False


def test_legacy_route():
    response = client.post('/plan', json=payload() | {'screenshot': {'redacted': True}, 'pii': {'findings': [], 'raw_values_sent': False}})
    assert response.status_code == 200


def test_privacy_rejects_email():
    body = payload()
    body['page']['nodes'][0]['name'] = 'user@example.com'
    response = client.post('/api/v1/plan', json=body)
    assert response.status_code == 422
    assert response.json()['detail']['code'] == 'privacy_violation'


def test_type_action_never_returns_raw_value():
    body = payload()
    body['instruction'] = 'type in the search box'
    body['page']['nodes'] = [
        {
            'ref': 'e1',
            'role': 'textbox',
            'name': 'Search',
            'text': '',
            'rect': {'x': 10, 'y': 10, 'width': 300, 'height': 30},
            'disabled': False,
            'visible': True,
        }
    ]
    response = client.post('/api/v1/plan', json=body)
    assert response.status_code == 200
    action = response.json()['action']
    assert action['type'] == 'type'
    assert action['value'] is None
    assert action['value_ref'] == 'LOCAL_USER_VALUE'
