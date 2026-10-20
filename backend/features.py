"""Chronologický výpočet příznaků bez úniku informací: každý zápas dostane příznaky jen z dat PŘED ním,
teprve potom se aktualizuje stav (Elo, forma, únava, H2H...)."""
import glob, math, pathlib, pickle, random, re
from collections import defaultdict, deque
import numpy as np, pandas as pd

ROOT = pathlib.Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
SURFS = ["Hard", "Clay", "Grass", "Carpet"]
ROUND_ORD = {"Q1": 0, "Q2": 1, "Q3": 2, "Q4": 3, "ER": 4, "R128": 5, "R64": 6, "R32": 7, "R16": 8, "QF": 9, "SF": 10, "BR": 11, "F": 12, "RR": 8}
FEATURES = ["elo_d", "selo_d", "elo_p", "logrank_d", "form_d", "fat_d", "inact_d", "h2h_d", "exp_d", "age_d",
            "unc_d", "level", "best_of", "surf_clay", "surf_grass", "is_qual", "female"]
LEVEL_CODE = {"ITF": 0, "Challenger": 1, "ATP": 2, "WTA": 2, "G": 3}

def circuit_of(fname, lvl, rnd):
    f = fname.name
    q = str(rnd).startswith("Q")
    if f.startswith("atp_matches_futures"): return "ITF muži", q
    if f.startswith("atp_matches_qual_chall"): return ("Challenger" if lvl == "C" else "ATP"), q
    if f.startswith("atp_matches_"): return "ATP", q
    if f.startswith("wta_matches_qual_itf"):
        return ("ITF ženy" if (str(lvl).startswith("I") or str(lvl).isdigit() or lvl in ("W", "15", "25")) else "WTA"), q
    return "WTA", q

def load():
    files = []
    for p in sorted(glob.glob(str(RAW / "atp" / "atp_matches_*.csv")) + sorted(glob.glob(str(RAW / "wta" / "wta_matches_*.csv")))):
        p = pathlib.Path(p)
        if "doubles" in p.name or "amateur" in p.name: continue
        files.append(p)
    dfs = []
    cols = ["tourney_id", "tourney_name", "surface", "tourney_level", "tourney_date", "match_num", "winner_id", "winner_name",
            "winner_age", "loser_id", "loser_name", "loser_age", "score", "best_of", "round", "winner_rank", "loser_rank"]
    for p in files:
        d = pd.read_csv(p, usecols=lambda c: c in cols, low_memory=False, encoding="latin-1" if False else "utf-8", encoding_errors="replace")
        g = "W" if p.name.startswith("wta") else "M"
        d["g"] = g
        circ = [circuit_of(p, l, r) for l, r in zip(d["tourney_level"].astype(str), d["round"].astype(str))]
        d["circuit"] = [c for c, _ in circ]; d["is_qual"] = [int(q) for _, q in circ]
        dfs.append(d)
    df = pd.concat(dfs, ignore_index=True)
    df = df.dropna(subset=["winner_id", "loser_id", "tourney_date"])
    df["score"] = df["score"].astype(str)
    df = df[~df["score"].str.contains("W/O|walkover|DEF|Def|unknown|nan", case=False, regex=True)]
    df["date"] = pd.to_datetime(df["tourney_date"].astype(int).astype(str), format="%Y%m%d", errors="coerce")
    df = df.dropna(subset=["date"])
    df["rord"] = df["round"].map(ROUND_ORD).fillna(5)
    df["wid"] = df["g"] + df["winner_id"].astype(int).astype(str)
    df["lid"] = df["g"] + df["loser_id"].astype(int).astype(str)
    df["surface"] = df["surface"].where(df["surface"].isin(SURFS), "Hard")
    df = df.sort_values(["date", "tourney_id", "rord", "match_num"], kind="mergesort").reset_index(drop=True)
    return df

def kfac(n): return 250.0 / (n + 5) ** 0.4

def expct(a, b): return 1.0 / (1.0 + 10 ** ((b - a) / 400.0))

class State:
    def __init__(self):
        self.elo = defaultdict(lambda: 1500.0); self.n = defaultdict(int)
        self.selo = defaultdict(lambda: 1500.0); self.sn = defaultdict(int)
        self.last = {}; self.recent = defaultdict(lambda: deque(maxlen=10))
        self.dates = defaultdict(lambda: deque(maxlen=40))
        self.resid = defaultdict(lambda: deque(maxlen=60))  # (ordinal date, actual-expected)
        self.h2h = defaultdict(int); self.rank = {}; self.age = {}; self.name = {}; self.gender = {}; self.rank_date = {}

    def player_feats(self, p, surf, day):
        last = self.last.get(p)
        inact = min((day - last), 365) if last is not None else 365
        fat = sum(1 for d in self.dates[p] if day - d <= 14)
        r = self.recent[p]; form = (sum(r) / len(r)) if r else 0.5
        rk = self.rank.get(p) or 2000
        rs = [x for d, x in self.resid[p] if day - d <= 60]
        exp = float(np.mean(rs)) if rs else 0.0
        return dict(elo=self.elo[p], selo=self.selo[(p, surf)], n=self.n[p], inact=inact, fat=fat, form=form,
                    rank=rk, exp=exp, age=self.age.get(p) or 25.0)

    def row(self, a, b, surf, day, level, best_of, q, female):
        A = self.player_feats(a, surf, day); B = self.player_feats(b, surf, day)
        return A, B, dict(
            elo_d=A["elo"] - B["elo"], selo_d=A["selo"] - B["selo"], elo_p=expct(A["elo"], B["elo"]),
            logrank_d=math.log(B["rank"]) - math.log(A["rank"]), form_d=A["form"] - B["form"], fat_d=A["fat"] - B["fat"],
            inact_d=A["inact"] - B["inact"], h2h_d=self.h2h[(a, b)] - self.h2h[(b, a)], exp_d=A["exp"] - B["exp"],
            age_d=A["age"] - B["age"], unc_d=math.log1p(A["n"]) - math.log1p(B["n"]), level=level, best_of=best_of,
            surf_clay=int(surf == "Clay"), surf_grass=int(surf == "Grass"), is_qual=q, female=female)

    def update(self, w, l, surf, day):
        ew, el = self.elo[w], self.elo[l]; e = expct(ew, el)
        self.elo[w] = ew + kfac(self.n[w]) * (1 - e); self.elo[l] = el - kfac(self.n[l]) * (1 - e)
        sw, sl = self.selo[(w, surf)], self.selo[(l, surf)]; se = expct(sw, sl)
        self.selo[(w, surf)] = sw + kfac(self.sn[(w, surf)]) * (1 - se); self.selo[(l, surf)] = sl - kfac(self.sn[(l, surf)]) * (1 - se)
        self.n[w] += 1; self.n[l] += 1; self.sn[(w, surf)] += 1; self.sn[(l, surf)] += 1
        for p, res, ex in ((w, 1, e), (l, 0, 1 - e)):
            self.recent[p].append(res); self.dates[p].append(day); self.last[p] = day; self.resid[p].append((day, res - ex))
        self.h2h[(w, l)] += 1

def level_code(circ, tl):
    if tl == "G": return 3
    return LEVEL_CODE.get(circ.split()[0] if circ.startswith("ITF") else circ, 2)

def build(df, seed=7):
    rng = random.Random(seed); st = State(); rows = []
    for r in df.itertuples(index=False):
        day = r.date.toordinal(); surf = r.surface; w, l = r.wid, r.lid
        st.name[w] = r.winner_name; st.name[l] = r.loser_name; st.gender[w] = st.gender[l] = r.g
        a, b, y = (w, l, 1) if rng.random() < 0.5 else (l, w, 0)
        lvl = level_code(r.circuit, r.tourney_level)
        bo = 5 if r.best_of == 5 else 3
        _, _, f = st.row(a, b, surf, day, lvl, bo, r.is_qual, int(r.g == "W"))
        f["y"] = y; f["date"] = day; f["circuit"] = r.circuit
        f["rank_a"] = (r.winner_rank if y else r.loser_rank); f["rank_b"] = (r.loser_rank if y else r.winner_rank)
        rows.append(f)
        # aktualizace AŽ po uložení příznaků
        for p, rk, ag in ((w, r.winner_rank, r.winner_age), (l, r.loser_rank, r.loser_age)):
            if rk == rk and rk: st.rank[p] = float(rk); st.rank_date[p] = day
            if ag == ag and ag: st.age[p] = float(ag)
        st.update(w, l, surf, day)
    return pd.DataFrame(rows), st

def freeze(st):
    """Převede stav na obyčejné dicty pro pickle."""
    d = {k: (dict(v) if isinstance(v, defaultdict) else v) for k, v in st.__dict__.items()}
    for k in ("recent", "dates", "resid"): d[k] = {p: list(q) for p, q in d[k].items()}
    return d
