"""Změří reálné zpoždění živých aktualizací přes SSE: interval mezi pushi, doba cyklu (stažení zdroje → push) a push → klient."""
import json, sys, time, urllib.request
url = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8765") + "/api/stream"
dur = float(sys.argv[2]) if len(sys.argv) > 2 else 60
r = urllib.request.urlopen(url, timeout=dur + 20); t_end = time.time() + dur; ups = []
for line in r:
    if time.time() > t_end: break
    line = line.decode().strip()
    if not line.startswith("data:"): continue
    m = json.loads(line[5:]); now = time.time()
    if m["type"] == "update":
        ups.append(dict(t=now, cycle_ms=(m["t_push"] - m["t_poll_start"]) * 1000, push_ms=(now - m["t_push"]) * 1000, n=len(m["matches"])))
        print(f"update: {len(m['matches'])} změn, cyklus {ups[-1]['cycle_ms']:.0f} ms, push→klient {ups[-1]['push_ms']:.1f} ms")
if len(ups) > 1:
    gaps = [b["t"] - a["t"] for a, b in zip(ups, ups[1:])]
    print(f"\npushů {len(ups)} za {dur:.0f} s; medián intervalu {sorted(gaps)[len(gaps)//2]:.1f} s; "
          f"medián cyklu {sorted(u['cycle_ms'] for u in ups)[len(ups)//2]:.0f} ms; medián push→klient {sorted(u['push_ms'] for u in ups)[len(ups)//2]:.1f} ms")
