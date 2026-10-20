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
    df["winner_id"] = df["winner_id"].astype(int).astype(str); df["loser_id"] = df["loser_id"].astype(int).astype(str)
    tml = load_tml(df)
    if tml is not None: df = pd.concat([df, tml], ignore_index=True)
    lr = load_live_results(df)
    if lr is not None: df = pd.concat([df, lr], ignore_index=True)
    df["score"] = df["score"].astype(str)
    df = df[~df["score"].str.contains("W/O|walkover|DEF|Def|unknown|nan", case=False, regex=True)]
    df["date"] = pd.to_datetime(df["tourney_date"].astype(int).astype(str), format="%Y%m%d", errors="coerce")
    df = df.dropna(subset=["date"])
    df["rord"] = df["round"].map(ROUND_ORD).fillna(5)
    df["wid"] = df["g"] + df["winner_id"].astype(str)
    df["lid"] = df["g"] + df["loser_id"].astype(str)
    df["surface"] = df["surface"].where(df["surface"].isin(SURFS), "Hard")
    df = df.sort_values(["date", "tourney_id", "rord", "match_num"], kind="mergesort").reset_index(drop=True)
    return df

def _nk(s):
    import unicodedata
    s = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode().lower()
    return " ".join(sorted(re.findall(r"[a-z]+", s)))

TML_GROUPS = [  # (gender, soubory, circuit, výběr Sackmann pro cutoff)
    ("M", ["2026.csv", "ongoing_tourneys.csv"], "ATP", lambda d: (d.g == "M") & (d.circuit == "ATP") & (d.is_qual == 0)),
    ("M", ["2026_challenger.csv", "challenger_ongoing_tourneys.csv"], "Challenger", lambda d: (d.g == "M") & (d.circuit == "Challenger")),
    ("M", ["2026_atp_quali.csv"], "ATP", lambda d: (d.g == "M") & (d.circuit == "ATP") & (d.is_qual == 1)),
    ("W", ["2026_wta.csv", "wta_ongoing_tourneys.csv"], "WTA", lambda d: (d.g == "W") & (d.circuit == "WTA")),
]

def load_tml(sack):
    """TennisMyLife (stats.tennismylife.org) – zápasy po konci Sackmannových dat. Hráči se párují na Sackmann id podle jména
    (pohlaví + jméno; při více shodách ten se shodnou zemí / víc zápasy). Nespárovaní dostanou nové id 't<TML id>'."""
    T = RAW / "tml"
    if not T.exists(): return None
    names = {}
    for g in ("M", "W"):
        sub = sack[sack.g == g]
        cnt = pd.concat([sub[["winner_id", "winner_name"]].set_axis(["id", "n"], axis=1), sub[["loser_id", "loser_name"]].set_axis(["id", "n"], axis=1)])
        vc = cnt.groupby(["id", "n"]).size().reset_index(name="c").sort_values("c")
        for i, n, c in vc.itertuples(index=False): names[(g, _nk(n))] = i  # nejčastější vyhraje (seřazeno vzestupně)
    out = []; stats = {}
    for g, files, circ, sel in TML_GROUPS:
        ds = [pd.read_csv(T / f, low_memory=False) for f in files if (T / f).exists() and (T / f).stat().st_size > 500]
        if not ds: continue
        d = pd.concat(ds, ignore_index=True)
        cutoff = int(sack[sel(sack)]["tourney_date"].max())
        d = d[d.tourney_date.astype(int) > cutoff].drop_duplicates(subset=["tourney_id", "winner_name", "loser_name", "round"]).copy()
        hit = miss = 0
        for side in ("winner", "loser"):
            ids = []
            for i, n in zip(d[side + "_id"], d[side + "_name"]):
                sid = names.get((g, _nk(n)))
                if sid is None: ids.append("t" + str(i)); miss += 1
                else: ids.append(sid); hit += 1
            d[side + "_id"] = ids
        d["g"] = g; d["circuit"] = circ
        d["is_qual"] = d["round"].astype(str).str.startswith("Q").astype(int) if circ != "ATP" or "quali" not in files[0] else 1
        d["tourney_level"] = d["tourney_level"].astype(str).map(lambda x: "G" if x == "G" else "C" if x == "C" else "A")
        d["best_of"] = pd.to_numeric(d["best_of"], errors="coerce").fillna(3)
        for c in ("winner_rank", "loser_rank", "winner_age", "loser_age"): d[c] = pd.to_numeric(d[c], errors="coerce")
        cols = ["tourney_id", "tourney_name", "surface", "tourney_level", "tourney_date", "match_num", "winner_id", "winner_name", "winner_age",
                "loser_id", "loser_name", "loser_age", "score", "best_of", "round", "winner_rank", "loser_rank", "g", "circuit", "is_qual"]
        d["match_num"] = pd.to_numeric(d["match_num"], errors="coerce").fillna(0)
        out.append(d[cols]); stats["+".join(files)] = dict(cutoff=cutoff, rows=len(d), max=int(d.tourney_date.max()) if len(d) else None, name_hit=hit, name_new=miss)
    print("TML:", stats)
    return pd.concat(out, ignore_index=True) if out else None

def load_live_results(base):
    """Zápasy dohrané podle živého feedu (ingest.py) – jen ty, které ještě nejsou v Sackmann/TML (dvojice ±10 dní)."""
    p = RAW / "live_results.csv"
    if not p.exists(): return None
    d = pd.read_csv(p)
    if not len(d): return None
    names = {}
    for g, wi, wn, li, ln in zip(base.g, base.winner_id, base.winner_name, base.loser_id, base.loser_name):
        names[(g, _nk(wn))] = wi; names[(g, _nk(ln))] = li
    def sur_ini(n):  # 'Novak Dj.' styl Flashscore 'Prijmeni J.' -> klíč příjmení+iniciála
        m = re.match(r"^(.*?)\s+([A-Za-z])[\w\-]*\.$", str(n).strip()); return (_nk(m.group(1)), m.group(2).lower()) if m else None
    si = {}
    for (g, k), i in names.items():
        t = k.split()
    # slug 'prijmeni-jmeno' -> plné jméno
    def pid(g, slug, name):
        r = names.get((g, _nk(str(slug).replace("-", " ")))) if isinstance(slug, str) and slug else None
        return r or "f" + _nk(str(slug or name)).replace(" ", "_")
    d["winner_id"] = [pid(g, s_, n) for g, s_, n in zip(d.g, d.winner_slug, d.winner_name)]
    d["loser_id"] = [pid(g, s_, n) for g, s_, n in zip(d.g, d.loser_slug, d.loser_name)]
    d["tourney_date"] = pd.to_datetime(d.date).dt.strftime("%Y%m%d").astype(int)
    recent = base[base.tourney_date.astype(int) >= int(d.tourney_date.min()) - 100]
    have = {}
    for g, w, l, t in zip(recent.g, recent.winner_id, recent.loser_id, recent.tourney_date.astype(int)):
        have.setdefault((g, frozenset((str(w), str(l)))), []).append(pd.Timestamp(str(t)).toordinal())
    keep = [not any(abs(pd.Timestamp(str(t)).toordinal() - x) <= 14 for x in have.get((g, frozenset((w, l))), []))
            for g, w, l, t in zip(d.g, d.winner_id, d.loser_id, d.tourney_date)]
    d = d[keep].copy()
    d["tourney_id"] = "fs-" + d.tourney_name.astype(str); d["tourney_level"] = d.circuit.map(lambda c: "C" if c in ("Challenger", "WTA 125") else "I" if c.startswith("ITF") else "A")
    d["match_num"] = 0; d["best_of"] = 3; d["round"] = d.is_qual.map(lambda q: "Q1" if q else "R32")
    for c in ("winner_age", "loser_age", "winner_rank", "loser_rank"): d[c] = float("nan")
    d["circuit"] = d.circuit.replace({"WTA 125": "WTA"})
    print("live_results přidáno:", len(d), dict(d.circuit.value_counts()))
    return d[["tourney_id", "tourney_name", "surface", "tourney_level", "tourney_date", "match_num", "winner_id", "winner_name", "winner_age",
              "loser_id", "loser_name", "loser_age", "score", "best_of", "round", "winner_rank", "loser_rank", "g", "circuit", "is_qual"]]

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
