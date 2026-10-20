"""Nově dohrané zápasy z Flashscore (všechny úrovně vč. ITF).

Denní retrain je přes update_csv() zapisuje do data/raw/live_results.csv.
Export CSV jen čte a seznam pro přepočet Elo ukládá do state.json, ne do release."""
import datetime, pathlib, pandas as pd
import sources as S, features as F

CSV = F.RAW / "live_results.csv"
COLS = ["fs_id", "date", "g", "circuit", "is_qual", "surface", "tourney_name", "winner_name", "loser_name", "winner_slug", "loser_slug", "score"]

def fs_id_set(values):
    """Id zápasů už v CSV. Prázdné a NaN se nepočítají, jinak by další řádek bez id vypadl."""
    out = set()
    for v in values:
        if v is None: continue
        try:
            if v != v: continue  # NaN
        except Exception:
            pass
        s = str(v).strip()
        if not s or s.lower() in ("nan", "none"): continue
        out.add(s)
    return out

def fetch_finished(days=range(-7, 1)):
    rows = []; today = datetime.datetime.now(S.TZ).date()
    for d in days:
        try: ev = S.flashscore(d)
        except Exception as e: print("fs fail", d, e); continue
        for m in ev:
            if m["status"] != "finished" or m["winner"] not in (1, 2) or not m["sets"]: continue
            if max(max(s) for s in m["sets"]) < 6 and len(m["sets"]) < 2: continue  # skreč na začátku
            w, l = (m["players"][0], m["players"][1]) if m["winner"] == 1 else (m["players"][1], m["players"][0])
            sc = " ".join(f"{a}-{b}" if m["winner"] == 1 else f"{b}-{a}" for a, b in m["sets"])
            dt = datetime.datetime.fromtimestamp(m["ts"], S.TZ).date()
            rows.append(dict(fs_id=m["fs"]["id"], date=dt.isoformat(), g=m["g"], circuit=m["circuit"], is_qual=m["qual"], surface=m["surface"],
                             tourney_name=m["tournament"], winner_name=w["name"], loser_name=l["name"], winner_slug=w.get("slug", ""), loser_slug=l.get("slug", ""), score=sc))
    return pd.DataFrame(rows, columns=COLS)

def merge_rows(extra):
    old = pd.read_csv(CSV) if CSV.exists() else pd.DataFrame(columns=COLS)
    parts = [old] if len(old) else []
    if extra is not None and len(extra):
        parts.append(extra)
    allr = pd.concat(parts, ignore_index=True) if parts else pd.DataFrame(columns=COLS)
    if len(allr):
        allr["fs_id"] = ["" if (x is None or x != x) else str(x) for x in allr["fs_id"]]
        allr = allr.drop_duplicates("fs_id", keep="last").sort_values("date")
        CSV.parent.mkdir(parents=True, exist_ok=True)
        allr.to_csv(CSV, index=False)
    print("live_results:", len(old), "->", len(allr))
    return allr

def update_csv():
    return merge_rows(fetch_finished())

def apply_to_state(P, rows):
    """Započte nové zápasy do Elo, formy a H2H. Neznámého hráče nenechá ve fs_seen, ať se zkusí znovu."""
    import online
    n, _ = online.apply_new(P, rows)
    return n

if __name__ == "__main__":
    update_csv()
