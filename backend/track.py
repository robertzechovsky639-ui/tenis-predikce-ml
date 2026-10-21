"""Track record: predikce uložené PŘED zápasem (stav upcoming/live) a později doplněný výsledek.
Dokončené zápasy, které jsme předem neviděli, se nezapočítají – jejich predikce by mohla znát výsledek."""
import json, math, time, urllib.request

MAX_ROWS = 10000
VALUE_EDGE = 0.05

def _pre_odds(m):
    o = m.get("odds")
    return [o.get("best_a"), o.get("best_b")] if o else None

def merge(prev, matches, now=None):
    """prev: dict id -> záznam; matches: aktuální export. Vrací nový dict (prev se nemění)."""
    now = now or time.time(); out = {k: dict(v) for k, v in (prev or {}).items()}
    for m in matches:
        mid = m.get("id"); p = m.get("pred")
        if not mid: continue
        r = out.get(mid)
        if r is None:
            if m.get("status") not in ("upcoming", "live") or p is None or m.get("demo"): continue
            pl = m.get("players") or [{}, {}]
            r = out[mid] = dict(id=mid, t=round(now), date=time.strftime("%Y-%m-%d", time.gmtime(m.get("ts") or now)),
                                a=pl[0].get("name"), b=pl[1].get("name"), circuit=m.get("circuit"), tournament=m.get("tournament"),
                                surface=m.get("surface"), p=round(float(p), 4), odds=None, winner=None, low=bool(m.get("pred_low")))
        if r.get("winner") is None and m.get("status") == "upcoming" and _pre_odds(m):  # kurz jen před začátkem
            r["odds"] = _pre_odds(m)
        if r.get("winner") is None and m.get("status") == "finished" and m.get("winner") in (1, 2):
            r["winner"] = int(m["winner"]); r["score"] = [list(s) for s in (m.get("sets") or [])]
    if len(out) > MAX_ROWS:
        out = dict(sorted(out.items(), key=lambda kv: kv[1].get("t", 0))[-MAX_ROWS:])
    return out

def value_side(p, odds, edge=VALUE_EDGE):
    """'A'/'B', když pravděpodobnost modelu převyšuje implikovanou z kurzu (návratnost >= edge)."""
    if not odds or not odds[0] or not odds[1]: return None
    if p * odds[0] - 1 >= edge: return "A"
    if (1 - p) * odds[1] - 1 >= edge: return "B"
    return None

def calibration(ps, ys, bins=10):
    out = []
    for i in range(bins):
        lo, hi = i / bins, (i + 1) / bins
        idx = [j for j, p in enumerate(ps) if lo <= p < hi or (i == bins - 1 and p == 1.0)]
        if idx: out.append(dict(lo=lo, hi=hi, n=len(idx), pred=round(sum(ps[j] for j in idx) / len(idx), 4),
                               real=round(sum(ys[j] for j in idx) / len(idx), 4)))
    return out

def summary(rows):
    done = [r for r in rows.values() if r.get("winner") in (1, 2)]
    ps = [r["p"] for r in done]; ys = [1 if r["winner"] == 1 else 0 for r in done]
    n = len(done)
    s = dict(n=n, pending=sum(1 for r in rows.values() if r.get("winner") is None))
    if n:
        eps = 1e-6
        s["accuracy"] = round(sum((p > .5) == bool(y) for p, y in zip(ps, ys)) / n, 4)
        s["brier"] = round(sum((p - y) ** 2 for p, y in zip(ps, ys)) / n, 4)
        s["log_loss"] = round(-sum(y * math.log(max(p, eps)) + (1 - y) * math.log(max(1 - p, eps)) for p, y in zip(ps, ys)) / n, 4)
        s["calibration"] = calibration(ps, ys)
    bets = []
    for r in done:
        side = value_side(r["p"], r.get("odds"))
        if side: bets.append((r["odds"][0] if side == "A" else r["odds"][1]) - 1 if (side == "A") == (r["winner"] == 1) else -1.0)
    s["value"] = dict(n=len(bets), won=sum(1 for b in bets if b > 0), profit=round(sum(bets), 2),
                      roi=round(sum(bets) / len(bets), 4) if bets else None)
    by = {}
    for r, y, p in zip(done, ys, ps):
        c = r.get("circuit") or "?"; b = by.setdefault(c, [0, 0]); b[0] += 1; b[1] += int((p > .5) == bool(y))
    s["by_circuit"] = {c: dict(n=v[0], accuracy=round(v[1] / v[0], 4)) for c, v in by.items()}
    return s

def publish(prev, matches, recent=300):
    rows = merge(prev, matches)
    lst = sorted(rows.values(), key=lambda r: r.get("t", 0), reverse=True)
    return rows, dict(generated=time.time(), summary=summary(rows), recent=lst[:recent], rows=lst)

def fetch_prev(url, timeout=20):
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r: d = json.load(r)
        return {x["id"]: x for x in d.get("rows", [])}
    except Exception as e:
        print("track: předchozí historie nedostupná:", e); return {}
