"""Backtest živé predikce na historických bodech grandslamů (Sackmann tennis_slam_pointbypoint, mirror Aneeshers).
Kontrolní body: začátek každého gemu. Předzápasová šance = Elo bez úniku (jen zápasy před turnajem).
Modely: baseline (současný živý Markov), bayes(k) (aktualizace bodů na podání), kalibrace (Platt podle stavu).
Trénink/ladění: 2011–2018, test: 2019–2024."""
import sys, re, json, math, glob, unicodedata, pathlib, collections
import numpy as np, pandas as pd
ROOT = pathlib.Path(__file__).resolve().parents[1]; sys.path.insert(0, str(ROOT / "backend"))
import markov, features as F
PBP = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "/workspace/pbp")
SLAM = {"ausopen": "Australian Open", "frenchopen": "Roland Garros", "wimbledon": "Wimbledon", "usopen": "Us Open"}

def nk(s):
    s = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode().lower()
    t = [x for x in re.split(r"[\s.\-']+", s) if x]
    return (t[0][0] if t else "", t[-1] if t else "")

def elo_priors():
    """Elo (celkové + povrch, jako v aplikaci) před každým zápasem grandslamu; klíč (rok, slam, frozenset jmen)."""
    df = F.load(); elo = collections.defaultdict(lambda: 1500.0); n = collections.defaultdict(int)
    selo = collections.defaultdict(lambda: 1500.0); sn = collections.defaultdict(int); out = {}
    for r in df.itertuples(index=False):
        w, l, s = r.wid, r.lid, r.surface
        if r.tourney_level == "G":
            nm = str(r.tourney_name).lower()
            slam = "ausopen" if "australian" in nm else "frenchopen" if ("roland" in nm or "french" in nm) else "wimbledon" if "wimbledon" in nm else "usopen" if "us open" in nm else None
            if slam:
                pw = F.expct(elo[w], elo[l]); psw = F.expct(selo[(w, s)], selo[(l, s)])
                out[(r.date.year if r.date.month > 1 or slam != "ausopen" else r.date.year + (1 if r.date.month == 12 else 0), slam, nk(r.winner_name), nk(r.loser_name))] = 0.5 * pw + 0.5 * psw
        e = F.expct(elo[w], elo[l]); elo[w] += F.kfac(n[w]) * (1 - e); elo[l] -= F.kfac(n[l]) * (1 - e); n[w] += 1; n[l] += 1
        e = F.expct(selo[(w, s)], selo[(l, s)]); selo[(w, s)] += F.kfac(sn[(w, s)]) * (1 - e); selo[(l, s)] -= F.kfac(sn[(l, s)]) * (1 - e); sn[(w, s)] += 1; sn[(l, s)] += 1
    return out

def games_of(pts):
    """Body zápasu -> seznam gemů (set, vítěz gemu, podávající, body na podání A/B do té doby)."""
    G = []; cur = None
    for r in pts.itertuples(index=False):
        key = (r.SetNo, r.GameNo)
        if cur is None or key != cur["key"]:
            if cur: G.append(cur)
            cur = dict(key=key, set=int(r.SetNo), server=int(r.PointServer), pts=[])
        cur["pts"].append((int(r.PointServer), int(r.PointWinner)))
    if cur: G.append(cur)
    return G

def checkpoints(G, bo):
    """Projde gemy, vrátí kontrolní body (stav před gemem) + vítěze; None při skreči/nekonzistenci."""
    need = bo // 2 + 1; done = []; ga = gb = 0; cps = []; srv = {1: [0, 0], 2: [0, 0]}  # [odehráno, vyhráno] na podání
    for i, g in enumerate(G):
        if g["set"] != len(done) + 1: return None, None
        cps.append(dict(done=list(done), cur=(ga, gb), server=g["server"], sv=json.loads(json.dumps(srv))))
        for s, w in g["pts"]: srv[s][0] += 1; srv[s][1] += int(w == s)
        win = g["pts"][-1][1]
        if win == 1: ga += 1
        else: gb += 1
        nxt = G[i + 1]["set"] if i + 1 < len(G) else None
        if nxt != g["set"]:
            if ga == gb: return None, None
            done.append((ga, gb)); ga = gb = 0
    sa = sum(1 for a, b in done if a > b); sb = len(done) - sa
    if max(sa, sb) != need: return None, None
    return cps, int(sa > sb)

def live_pp(pa, pb, c, bo):
    sa = sum(1 for a, b in c["done"] if a > b); sb = len(c["done"]) - sa
    tb = 10 if len(c["done"]) >= bo - 1 else 7
    ga, gb = c["cur"]
    while max(ga, gb) > 6 or (ga == 6 and gb == 6 and False): ga -= 1; gb -= 1  # výhodový set (12:10) -> ekvivalent
    return markov.match_prob(pa, pb, sa, sb, ga, gb, c["server"] == 1, (0, 0), bo, tb)

def main():
    import pickle, os
    pp = "/workspace/pbp/priors.pkl"
    pri = pickle.load(open(pp, "rb")) if os.path.exists(pp) else elo_priors(); pickle.dump(pri, open(pp, "wb")); print("prior grandslamů:", len(pri), flush=True)
    rows = []
    for mf in sorted(glob.glob(str(PBP / "*-matches.csv"))):
        pf = mf.replace("-matches", "-points"); yr, slam = re.match(r".*/(\d{4})-(\w+?)-matches", mf).groups(); yr = int(yr)
        M = pd.read_csv(mf, low_memory=False); P = pd.read_csv(pf, low_memory=False, usecols=["match_id", "SetNo", "GameNo", "PointServer", "PointWinner"]).dropna()
        P = P[(P.PointServer.isin([1, 2])) & (P.PointWinner.isin([1, 2]))]
        for mid, pts in P.groupby("match_id", sort=False):
            mm = M[M.match_id == mid]
            if mm.empty: continue
            mm = mm.iloc[0]; k1, k2 = nk(mm.player1), nk(mm.player2)
            mn = str(mm.match_num).upper(); male = mn.startswith("1") or mn.startswith("M"); bo = 5 if male else 3
            p = pri.get((yr, slam, k1, k2)); flip = False
            if p is None:
                p = pri.get((yr, slam, k2, k1)); p = None if p is None else 1 - p
            if p is None: continue
            cps, y = checkpoints(games_of(pts), bo)
            if not cps or len(cps) < 6: continue
            pa0, pb0 = markov.serve_probs(min(max(p, .02), .98), not male, bo)
            rows.append(dict(id=mid, year=yr, male=male, bo=bo, p=p, pa0=pa0, pb0=pb0, y=y, cps=cps))
    print("zápasů:", len(rows), "kontrolních bodů:", sum(len(r["cps"]) for r in rows), flush=True)
    import pickle; pickle.dump(rows, open("/workspace/pbp/rows.pkl", "wb"))

if __name__ == "__main__":
    main()
