"""Exercise offline registration, batch recovery, resume, and validation locally."""
import json
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

base = 'http://127.0.0.1:8787'
cases = json.loads(Path('data/cases.json').read_text())

def call(path, method='POST', body=None, auth=None, admin=None):
    headers={'Content-Type': 'text/plain', 'Origin': 'https://tony-lowe.github.io'}
    if auth: headers['Authorization']='Participant ' + auth
    if admin: headers['Authorization']='Bearer ' + admin
    req = urllib.request.Request(base + path, data=json.dumps(body).encode() if body is not None else None,
                                 method=method, headers=headers)
    for attempt in range(4):
        try: response = urllib.request.urlopen(req)
        except urllib.error.HTTPError as error: response = error
        raw=response.read()
        if response.status==503 and raw.startswith(b'Your worker restarted mid-request') and attempt<3:
            time.sleep(.1)
            continue
        return response.status, json.loads(raw)
    raise AssertionError('Worker did not recover')

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

admin_key=Path('.admin-key').read_text().strip()
manual_token=str(uuid.uuid4())+str(uuid.uuid4())
manual_id=str(uuid.uuid4())
manual_assignments=[{**a,'id':str(uuid.uuid4())} for a in assignments]
manual_votes=[{'trialId':a['id'],'dimension':dim,'choice':'tie','reasons':[],'comment':'','elapsedMs':500}
              for a in manual_assignments for dim in ('aesthetic','adherence')]
answer={'kind':'design-preference-study-offline-answer','version':cases['version'],'participant':manual_id[:8],
        'token':manual_token,'session':{'id':manual_id,'version':cases['version'],'assignments':manual_assignments},
        'demo':True,'votes':manual_votes}
assert call('/api/admin/import',body=answer)[0]==401
for i in range(0,24,6):
    status,imported=call('/api/admin/import',body={**answer,'votes':manual_votes[i:i+6]},admin=admin_key)
    assert status==200 and imported['imported']==6 and imported['saved']==i+6 and imported['demo'],(status,imported)
try:
    status,repeated=call('/api/admin/import',body={**answer,'votes':manual_votes[:6]},admin=admin_key)
    assert status==200 and repeated['imported']==0 and repeated['saved']==24
finally:
    assert call('/api/session',method='DELETE',auth=manual_token)[0]==200
print('offline registration, batch recovery, manual admin import, idempotency, and resume passed')
