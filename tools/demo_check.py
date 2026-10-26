"""Builds the first preset (and, with --all, every preset) and says PASS or FAIL for each build.

    python tools/demo_check.py                          the local `wrangler dev` on port 8787
    python tools/demo_check.py https://<host> 3         three rounds against a deployed Worker
    python tools/demo_check.py https://<host> 3 --fresh round 1 asks for a live build (a new town spelling), then cache

A build passes when it has no error, four rounds of five questions, every entity option carries a Qloo id, the field
the question used and a popularity inside the round's band, the meter's mean is inside the band, the build made at most
16 Qloo calls, and a room can be opened from it. The mode (live, template, cache, replay) is printed.
"""
import json
import sys
import time
import urllib.error
import urllib.request

args = [a for a in sys.argv[1:] if not a.startswith('--')]
BASE = args[0].rstrip('/') if args else 'http://127.0.0.1:8787'
ROUNDS = int(args[1]) if len(args) > 1 else 1
FRESH = '--fresh' in sys.argv
ALL = '--all' in sys.argv
HEADERS = {'Content-Type': 'application/json', 'User-Agent': 'right-pitch-demo-check/1.0', 'Origin': BASE}


def post(path, body, stream=False):
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode(), headers=HEADERS)
    r = urllib.request.urlopen(req, timeout=240)
    return [json.loads(line) for line in r if line.strip()] if stream else json.load(r)


def judge(events):
    faults = []
    errors = [e['text'] for e in events if e['t'] == 'error']
    if errors:
        return ['error: ' + errors[0]]
    done = next((e['quiz'] for e in events if e['t'] == 'done'), None)
    if not done:
        return ['no done event']
    if len(done['rounds']) != 4:
        faults.append(f"{len(done['rounds'])} rounds")
    seen = set()
    for i, rnd in enumerate(done['rounds'], 1):
        band, meter = rnd['meter']['band'], rnd['meter']
        if len(rnd['questions']) != 5:
            faults.append(f"round {i}: {len(rnd['questions'])} questions")
        if not (band['min'] - 1e-9 <= meter['mean'] <= band['max'] + 1e-9):
            faults.append(f"round {i}: meter mean {meter['mean']:.3f} outside {band['min']} to {band['max']}")
        for q in rnd['questions']:
            if not (0 <= q['answer'] < len(q['options'])):
                faults.append(f"round {i}: answer index out of range")
            for o in q['options']:
                rec = o.get('record')
                if rnd['kind'] == 'generation' and not rec:
                    continue
                if not rec or not rec.get('qlooId') or rec.get('value') in (None, ''):
                    faults.append(f"round {i}: an option with no Qloo record or field")
                    continue
                if not (band['min'] - 1e-9 <= rec['popularity'] <= band['max'] + 1e-9):
                    faults.append(f"round {i}: {rec['popularity']:.3f} outside the band")
                if rec['qlooId'] in seen and rnd['kind'] != 'generation':
                    faults.append(f"round {i}: an entity used twice")
                seen.add(rec['qlooId'])
    if done['qlooCalls'] > 16:
        faults.append(f"{done['qlooCalls']} Qloo calls")
    return faults


def main():
    presets = json.load(urllib.request.urlopen(urllib.request.Request(BASE + '/api/presets', headers=HEADERS)))
    chosen = presets if ALL else presets[:1]
    failed = 0
    rooms = {}  # one room per quiz: a replay gives the same quiz, and rooms are capped at 3 a visitor a day
    for rnd in range(1, ROUNDS + 1):
        for preset in chosen:
            setup = dict(preset['setup'])
            if FRESH and rnd == 1:
                # A new night name makes a new cache key (the whole setup is the key), so round 1 is a live build.
                setup['night'] = 'Check ' + time.strftime('%H%M%S')
            t0 = time.time()
            try:
                events = post('/api/build', {'setup': setup}, stream=True)
            except urllib.error.HTTPError as e:
                events = [{'t': 'error', 'text': f'HTTP {e.code} {e.read()[:200]!r}'}]
            faults = judge(events)
            start = next((e for e in events if e['t'] == 'start'), {})
            done = next((e['quiz'] for e in events if e['t'] == 'done'), None)
            room = ''
            if done and not faults and done['id'] in rooms:
                room = rooms[done['id']] + ' (same quiz)'
            elif done and not faults:
                try:
                    made = post('/api/rooms', {'quiz': done['id']})
                    room = rooms[done['id']] = made.get('code', '')
                    if not room or not made.get('hostToken'):
                        faults.append('no room code or host token')
                except urllib.error.HTTPError as e:
                    faults.append(f'room HTTP {e.code}')
            failed += bool(faults)
            kinds = [r['kind'] for r in done['rounds']] if done else []
            print(f"round {rnd} {preset['name']}: {'FAIL ' + '; '.join(faults) if faults else 'PASS'} | mode {start.get('mode')} | "
                  f"{done['qlooCalls'] if done else '?'} Qloo calls | {done['neurons'] if done else '?'} neurons | {kinds} | room {room} | "
                  f"{time.time() - t0:.1f}s")
    print('ALL PASS' if not failed else f'{failed} FAILED')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
