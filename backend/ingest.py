"""Nově dohrané zápasy z živých zdrojů (Flashscore −7..0 dní: všechny úrovně vč. ITF) -> data/raw/live_results.csv (kumulativně).
Používá se (1) při každém exportu k průběžné aktualizaci Elo/formy bez přetrénování, (2) při denním přetrénování jako trénovací data."""
import datetime, pathlib, pandas as pd
import sources as S, features as F

CSV = F.RAW / "live_results.csv"
COLS = ["fs_id", "date", "g", "circuit", "is_qual", "surface", "tourney_name", "winner_name", "loser_name", "winner_slug", "loser_slug", "score"]

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

def update_csv():
    new = fetch_finished(); old = pd.read_csv(CSV) if CSV.exists() else pd.DataFrame(columns=COLS)
    allr = pd.concat([old, new], ignore_index=True).drop_duplicates("fs_id", keep="last").sort_values("date")
    CSV.parent.mkdir(parents=True, exist_ok=True); allr.to_csv(CSV, index=False)
    print("live_results:", len(old), "->", len(allr), "(+", len(allr) - len(old), ")"); return allr

def apply_to_state(P, rows):
    """Průběžná aktualizace: započte zápasy, které ve stavu ještě nejsou (podle dvojice a data ±10 dní)."""
    n = 0; seen = set(P.s.setdefault("fs_seen", set())); P.s["fs_seen"] = seen
    for r in rows.itertuples(index=False):
        if r.fs_id in seen: continue
        w = P.find(r.g, str(r.winner_slug).replace("-", " ") or r.winner_name, r.winner_name) or P.find(r.g, None, r.winner_name)
        l = P.find(r.g, str(r.loser_slug).replace("-", " ") or r.loser_name, r.loser_name) or P.find(r.g, None, r.loser_name)
        day = datetime.date.fromisoformat(r.date).toordinal(); seen.add(r.fs_id)
        if not (w and l) or day <= P.s["last"].get(w, 0) and day <= P.s["last"].get(l, 0) and P.known_result(w, l, day): continue
        if P.known_result(w, l, day): continue
        P.apply_result(w, l, r.surface, day); n += 1
    P.ref_day = min(datetime.date.today().toordinal(), max(P.s["last"].values()) + 1)
    return n

if __name__ == "__main__":
    update_csv()
