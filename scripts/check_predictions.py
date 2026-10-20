#!/usr/bin/env python3
"""Kolik zápasů bez predikce ji teď dostane.

Čte zachycený export (data/matches.json, jinak /tmp/matches.json) a hráče
(data/players.json, jinak /tmp/players.json). Volitelně doplní rozpis Sofascore.
Vytiskne počty a zapíše tests/fixtures/unpredicted.json pro offline test.
"""
import json, re, unicodedata, pathlib, sys, urllib.request
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "backend"))
import fallback as FB

ROOT = pathlib.Path(__file__).resolve().parents[1]
SS_CATS = [3, 6, 72, 785, 213]
SS_CIRC = {"ATP": "ATP", "WTA": "WTA", "Challenger": "Challenger", "WTA 125": "WTA 125", "ITF Men": "ITF muži", "ITF Women": "ITF ženy"}


def norm(s):
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z]", "", s)


def last_tok(n):
    n = str(n or "").strip()
    m = re.match(r"^(.*?)\s+[A-Z][\w\-]*\.$", n)
    parts = re.split(r"[\s\-]+", m.group(1) if m else n)
    parts = [x for x in parts if x]
    return norm(parts[-1]) if parts else ""


def old_find(rows, g, name):
    """Původní párování v prohlížeči: celé jméno, jinak příjmení + první písmeno řetězce."""
    k = norm(name)
    hit = [p for p in rows if p[0][0] == g and norm(p[1]) == k]
    if hit:
        return hit[0]
    ini = norm(str(name).strip()[:1] or "")
    k2 = last_tok(name)
    c = [p for p in rows if p[0][0] == g and last_tok(p[1]) == k2 and (norm(p[1])[:1] == ini)]
    return c[0] if len(c) == 1 else None


def old_would_predict(m, rows):
    if m.get("pred") is not None:
        return True
    ids = []
    for i, p in enumerate(m["players"]):
        known = None
        if m.get("pids") and m["pids"][i]:
            known = next((r for r in rows if r[0] == m["pids"][i]), None)
        if not known:
            known = old_find(rows, m["g"], p.get("name"))
        if known:
            ids.append(known[2])
        elif p.get("ranking"):
            ids.append(1)
        else:
            ids.append(None)
    if all(x is not None for x in ids):
        return True
    # starý rankPred: obě strany bez Ela i žebříčku → žádná predikce; jedna známá stačila
    if any(x is not None for x in ids):
        return True
    return False


def slim(m):
    return {
        "id": m.get("id"), "g": m.get("g"), "circuit": m.get("circuit"), "qual": m.get("qual") or 0,
        "surface": m.get("surface") or "Hard", "status": m.get("status"),
        "players": [{"name": p.get("name"), "ranking": p.get("ranking")} for p in m["players"]],
        "pids": list(m.get("pids") or [None, None]), "pred": m.get("pred"),
    }


def load_json(name, fallback):
    for p in (ROOT / "data" / name, pathlib.Path(fallback)):
        if p.exists():
            return json.loads(p.read_text())
    return None


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read().decode())


def sofa_matches():
    import datetime
    out = []
    days = [datetime.date.today().isoformat(), (datetime.date.today() + datetime.timedelta(days=1)).isoformat()]
    for c in SS_CATS:
        for d in days:
            try:
                data = fetch(f"https://api.sofascore1.com/api/v1/category/{c}/scheduled-events/{d}")
            except Exception as e:
                print("sofa skip", c, d, type(e).__name__, file=sys.stderr)
                continue
            for e in data.get("events") or []:
                if e.get("status", {}).get("type") != "notstarted":
                    continue
                H, A = e.get("homeTeam") or {}, e.get("awayTeam") or {}
                if H.get("type") != 1 or A.get("type") != 1:
                    continue
                circ = SS_CIRC.get((e.get("tournament") or {}).get("category", {}).get("name"))
                if not circ:
                    continue
                g = "W" if H.get("gender") == "F" else "M"
                out.append({
                    "id": "ss-" + str(e.get("id")), "g": g, "circuit": circ,
                    "qual": 1 if re.search(r"qualif", ((e.get("tournament") or {}).get("name") or "") + " " + ((e.get("roundInfo") or {}).get("name") or ""), re.I) else 0,
                    "surface": "Hard", "status": "upcoming", "pred": None, "pids": [None, None],
                    "players": [{"name": H.get("name"), "ranking": H.get("ranking")}, {"name": A.get("name"), "ranking": A.get("ranking")}],
                    "src": "sofa-schedule",
                })
    return out


def main():
    raw = load_json("matches.json", "/tmp/matches.json")
    players = load_json("players.json", "/tmp/players.json")
    if not raw or not players:
        print("chybí matches.json nebo players.json", file=sys.stderr)
        return 1
    matches = raw["matches"] if isinstance(raw, dict) else raw
    export_missing = [m for m in matches if m.get("pred") is None]
    try:
        sofa = sofa_matches()
    except Exception as e:
        print("sofa nedostupné", e, file=sys.stderr)
        sofa = []
    export_ids = set()
    # párování rozpisu na export podle příjmení, ať se zápas nepočítá dvakrát
    def pair(m):
        return m["g"] + "|" + "|".join(sorted(last_tok(p["name"]) for p in m["players"]))
    known_pairs = {pair(m) for m in matches}
    sofa_new = [m for m in sofa if pair(m) not in known_pairs]
    # starý klient: export s pred null + sofa zápasy, které staré párování/žebříček nevyplní
    # Export má pred null u všech těchto zápasů (hotové starý klient přeskočil, oba neznámí taky).
    before_export = export_missing
    before_sofa = [m for m in sofa_new if not old_would_predict(m, players)]
    watched = [slim(m) for m in before_export] + [slim(m) for m in before_sofa]
    for m in watched:
        if m["id"] in {x.get("id") for x in before_sofa}:
            m["src"] = "sofa-schedule"
        else:
            m["src"] = "export"

    # hráči, kteří mohou rozhodnout shodu (včetně nejednoznačných klíčů)
    rx = FB.build_relax({p[0]: p[1] for p in players})
    full = {}
    for p in players:
        t = FB.toks(p[1])
        if not t:
            continue
        k = (p[0][0], " ".join(sorted(t)))
        prev = full.get(k)
        if prev is None or p[6] > prev[6]:
            full[k] = p
    need = set()
    for m in watched:
        for i, pl in enumerate(m["players"]):
            if m["pids"][i]:
                need.add(m["pids"][i])
            t = FB.toks(pl["name"])
            if t:
                hit = full.get((m["g"], " ".join(sorted(t))))
                if hit:
                    need.add(hit[0])
            for sur, ini in FB.relax_keys(pl["name"]):
                k = (m["g"], sur, ini)
                if k in rx and rx[k]:
                    need.add(rx[k])
                elif k in rx and rx[k] is None:
                    for p in players:
                        if p[0][0] == m["g"] and (sur, ini) in FB.relax_keys(p[1]):
                            need.add(p[0])
    by_id = {p[0]: p for p in players}
    subset = [by_id[i] for i in sorted(need) if i in by_id]
    out = {"before_missing": len(watched), "export_missing": len(before_export), "sofa_missing": len(before_sofa), "matches": watched, "players": subset}
    dest = ROOT / "tests" / "fixtures" / "unpredicted.json"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
    print(f"bez predikce před opravou: {len(watched)} (export {len(before_export)}, sofascore mimo export {len(before_sofa)})")
    print(f"hráčů ve fixture: {len(subset)} · zápasů ve fixture: {len(watched)} · {dest.stat().st_size} B")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
