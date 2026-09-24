"""Exercise offline registration, batch recovery, resume, and validation locally."""
import json
import urllib.error
import urllib.request
import uuid
from pathlib import Path

base = 'http://127.0.0.1:8787'
cases = json.loads(Path('data/cases.json').read_text())

def call(path, method='POST', body=None, auth=None):
    headers={'Content-Type': 'text/plain', 'Origin': 'https://tony-lowe.github.io'}
    if auth: headers['Authorization']='Participant ' + auth
    req = urllib.request.Request(base + path, data=json.dumps(body).encode() if body is not None else None,
                                 method=method, headers=headers)
    try: response = urllib.request.urlopen(req)
    except urllib.error.HTTPError as error: response = error
    return response.status, json.load(response)

assignments = []
for pool in ('user_selected', 'prior_reviewed'):
    selected = [case for case in cases['cases'] if case['pool'] == pool][:6]
    for i, case in enumerate(selected):
        opponent = 'creatidesign' if i < 3 else 'uno'
        ours_left = i % 3 < (2 if pool == 'user_selected' else 1)
        assignments.append({'id': str(uuid.uuid4()), 'caseId': case['id'], 'pool': pool,
                            'left': 'ours' if ours_left else opponent,
                            'right': opponent if ours_left else 'ours'})

token = str(uuid.uuid4()) + str(uuid.uuid4())
session_id = str(uuid.uuid4())
registration = {'consent': True, 'plan': True, 'demo': True, 'resumeToken': token,
                'offlineSession': {'id': session_id, 'version': cases['version'], 'assignments': assignments}}
bad = json.loads(json.dumps(registration))
bad['offlineSession']['assignments'][0]['caseId'] = 'invalid'
assert call('/api/session', body=bad)[0] == 400
status, created = call('/api/session', body=registration)
assert status == 201, (status, created)
assert created['participant'] == session_id[:8] and len(created['plan']) == 12
assert created['resumeToken'] == token
try:
    assert call('/api/session', body=registration)[0] == 200
    votes = [{'trialId': a['id'], 'dimension': dim, 'choice': 'tie', 'reasons': [], 'comment': '', 'elapsedMs': 500}
             for a in assignments for dim in ('aesthetic', 'adherence')]
    status, saved = call('/api/votes', body={'resumeToken': token, 'votes': votes})
    assert status == 200 and saved['saved'] == 24, (status, saved)
    status, duplicate = call('/api/votes', body={'resumeToken': token, 'votes': votes})
    assert status == 200 and duplicate['saved'] == 24
    status, resumed = call('/api/session', body={'resume': True, 'plan': True, 'resumeToken': token})
    assert status == 200 and resumed['done'] and len(resumed['savedVotes']) == 24
finally:
    assert call('/api/session', method='DELETE', auth=token)[0] == 200
print('offline registration, validation, batch recovery, idempotency, and resume passed')
