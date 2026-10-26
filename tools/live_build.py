"""One build against the hosted app, printed round by round, saved to out/ (git ignored: it holds Qloo data).
python tools/live_build.py [preset index] [--night NAME] [--base URL]"""
import json
import sys
import time
import urllib.request

B = sys.argv[sys.argv.index('--base') + 1].rstrip('/') if '--base' in sys.argv else 'https://right-pitch.midknight-labs.workers.dev'
UA = {'User-Agent': 'Mozilla/5.0 right-pitch-check', 'Origin': B, 'content-type': 'application/json'}


def get(path):
    return json.load(urllib.request.urlopen(urllib.request.Request(B + path, headers=UA), timeout=30))


def main():
    index = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else 0
    setup = get('/api/presets')[index]['setup']
    if '--night' in sys.argv:
        setup['night'] = sys.argv[sys.argv.index('--night') + 1]
    req = urllib.request.Request(B + '/api/build', data=json.dumps({'setup': setup}).encode(), headers=UA)
    start, events = time.time(), []
    with urllib.request.urlopen(req, timeout=240) as r:
        for line in r:
            if line.strip():
                events.append(json.loads(line))
    print(round(time.time() - start, 1), 's,', len(events), 'events')
    with open(f'out/live-build-{index}-{int(start)}.json', 'w', encoding='utf-8') as f:
        json.dump(events, f)
    for e in events:
        if e['t'] == 'call':
            print('call round', e['round'], e['path'], 'results', e['results'], e['ms'], 'ms', 'cached' if e['cached'] else '')
        elif e['t'] == 'question' and not e['ok']:
            print('drop', e['round'], e['index'], e.get('why'))
        elif e['t'] in ('start', 'plan', 'replan', 'usage', 'error'):
            print(e['t'], json.dumps({k: v for k, v in e.items() if k != 't'})[:300])
        elif e['t'] == 'done':
            q = e['quiz']
            print('done', q['id'], q['mode'], 'qloo', q['qlooCalls'], 'neurons', q['neurons'])
            for rd in q['rounds']:
                m = rd['meter']
                print(f" ROUND {rd['kind']} {rd['level']} '{rd['title']}' | {rd['banter']} | mean {m['mean']:.3f} min {m['min']:.3f} max {m['max']:.3f} n {m['n']}")
                for qq in rd['questions']:
                    print('   Q', qq['prompt'], '->', [o['label'] for o in qq['options']], 'ans', qq['answer'], '|', qq['reveal'])


main()
