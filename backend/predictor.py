"""Načtení modelu + stavu, párování jmen a predikce pro libovolnou dvojici hráčů."""
import datetime, math, pickle, re, unicodedata
import warnings
import numpy as np, pandas as pd, lightgbm as lgb
warnings.filterwarnings("ignore", message="X does not have valid feature names")
import features as F

MD = F.ROOT / "data" / "model"
NAMES_CZ = {"elo_d": "Elo celkové", "selo_d": "Elo na povrchu", "elo_p": "Elo očekávání", "logrank_d": "Žebříček",
            "form_d": "Forma (posl. 10 zápasů)", "fat_d": "Zápasy za 14 dní (únava)", "inact_d": "Neaktivita (dny bez zápasu)",
            "h2h_d": "Vzájemné zápasy (H2H)", "exp_d": "Forma vs. očekávání Elo (60 dní)", "age_d": "Věk", "unc_d": "Nejistota ratingu",
            "spw_d": "Body vyhrané na podání", "rpw_d": "Body vyhrané na returnu"}

def toks(s):
    s = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode().lower()
    return [t for t in re.split(r"[^a-z]+", s) if t]

class Predictor:
    def __init__(self):
        self.gbm = lgb.Booster(model_file=str(MD / "gbm.txt"))
        lr = pickle.load(open(MD / "logreg.pkl", "rb")); self.sc, self.lr = lr["scaler"], lr["lr"]
        self.s = pickle.load(open(MD / "state.pkl", "rb"))
        # referenční den = konec historických dat (aby únava/neaktivita nebyly zkreslené mezerou v datech)
        self.ref_day = min(datetime.date.today().toordinal(), max(self.s["last"].values()) + 1)
        self.matches = pd.read_pickle(MD / "matches.pkl")
        self.full, self.sur = {}, {}
        for pid, nm in self.s["name"].items():
            g = pid[0]; t = toks(nm); n = self.s["n"].get(pid, 0)
            if not t: continue
            k = (g, " ".join(sorted(t)))
            if k not in self.full or n > self.s["n"].get(self.full[k], 0): self.full[k] = pid
            for i in range(1, len(t)):
                k2 = (g, "".join(t[i:]), t[0][0])
                if k2 not in self.sur or n > self.s["n"].get(self.sur[k2], 0): self.sur[k2] = pid
            if len(t) >= 2:
                k3 = (g, "".join(t[:-1]), t[-1][0])
                self.sur.setdefault(k3, pid)

    def find(self, g, full=None, short=None):
        """full = 'Jiri Lehecka' / slug 'lehecka-jiri', short = 'Lehecka J.' (Flashscore) nebo 'J. Lehecka' (ESPN)."""
        if full:
            r = self.full.get((g, " ".join(sorted(toks(full)))))
            if r: return r
        if short:
            m = re.match(r"^(.*?)\s+([A-Za-z])[\w\-]*\.$", short.strip())
            if m: sur, ini = "".join(toks(m.group(1))), m.group(2).lower()
            else:
                m = re.match(r"^([A-Za-z])\.\s*(.+)$", short.strip())
                if not m: return None
                ini, sur = m.group(1).lower(), "".join(toks(m.group(2)))
            return self.sur.get((g, sur, ini))
        return None

    def card(self, pid, surf):
        s = self.s; day = self.ref_day
        r = s["recent"].get(pid, []); res = s["resid"].get(pid, [])
        return dict(id=pid, name=s["name"].get(pid), elo=round(s["elo"].get(pid, 1500)), selo=round(s["selo"].get((pid, surf), 1500)),
                    rank=int(s["rank"][pid]) if pid in s["rank"] else None, form=f"{sum(r)}/{len(r)}", form_w=sum(r), form_n=len(r),
                    matches=s["n"].get(pid, 0), last=datetime.date.fromordinal(s["last"][pid]).isoformat() if pid in s["last"] else None,
                    resid=[(datetime.date.fromordinal(d).isoformat(), round(x, 3)) for d, x in res])

    def feats(self, a, b, surf, level, best_of, q, female):
        s = self.s; day = self.ref_day
        def pf(p):
            last = s["last"].get(p); r = s["recent"].get(p, [])
            rs = [x for d, x in s["resid"].get(p, []) if day - d <= 60]
            sv = s.get("srv", {}).get(p) or []
            return dict(spw=float(np.mean([x[0] for x in sv])) if sv else np.nan, rpw=float(np.mean([x[1] for x in sv])) if sv else np.nan,
                        elo=s["elo"].get(p, 1500.0), selo=s["selo"].get((p, surf), 1500.0), n=s["n"].get(p, 0),
                        inact=min(day - last, 365) if last else 365, fat=sum(1 for d in s["dates"].get(p, []) if day - d <= 14),
                        form=sum(r) / len(r) if r else 0.5, rank=s["rank"].get(p) or 2000, exp=float(np.mean(rs)) if rs else 0.0,
                        age=s["age"].get(p) or 25.0)
        A, B = pf(a), pf(b); h = s["h2h"]
        return dict(elo_d=A["elo"] - B["elo"], selo_d=A["selo"] - B["selo"], elo_p=F.expct(A["elo"], B["elo"]),
                    logrank_d=math.log(B["rank"]) - math.log(A["rank"]), form_d=A["form"] - B["form"], fat_d=A["fat"] - B["fat"],
                    inact_d=A["inact"] - B["inact"], h2h_d=h.get((a, b), 0) - h.get((b, a), 0), exp_d=A["exp"] - B["exp"],
                    age_d=A["age"] - B["age"], unc_d=math.log1p(A["n"]) - math.log1p(B["n"]), level=level, best_of=best_of,
                    surf_clay=int(surf == "Clay"), surf_grass=int(surf == "Grass"), is_qual=q, female=female,
                    spw_d=A["spw"] - B["spw"], rpw_d=A["rpw"] - B["rpw"])

    def predict(self, a, b, surf="Hard", level=2, best_of=3, q=0, female=0):
        f = self.feats(a, b, surf, level, best_of, q, female)
        x = np.array([[f[k] for k in F.FEATURES]])
        # symetrizace: průměr p(A,B) a 1-p(B,A)
        fb = self.feats(b, a, surf, level, best_of, q, female); xb = np.array([[fb[k] for k in F.FEATURES]])
        p = float((self.gbm.predict(x)[0] + 1 - self.gbm.predict(xb)[0]) / 2)
        x0 = np.nan_to_num(x, nan=0.0); z = self.sc.transform(x0)[0]; contrib = z * self.lr.coef_[0]
        factors = sorted([dict(key=k, label=NAMES_CZ[k], value=round(float(c), 3), favors="A" if c > 0 else "B")
                          for k, c in zip(F.FEATURES, contrib) if k in NAMES_CZ and abs(c) > 0.01], key=lambda d: -abs(d["value"]))
        h = self.s["h2h"]
        return dict(p=p, p_lr=float(self.lr.predict_proba(self.sc.transform(x0))[0, 1]), elo_p=f["elo_p"], factors=factors[:7],
                    h2h=[h.get((a, b), 0), h.get((b, a), 0)])

    def h2h_list(self, a, b, n=15):
        m = self.matches; sel = m[((m.wid == a) & (m.lid == b)) | ((m.wid == b) & (m.lid == a))].tail(n)
        return [dict(date=str(r.date.date()), tournament=r.tourney_name, surface=r.surface, round=r.round, score=r.score,
                     winner="A" if r.wid == a else "B") for r in sel.itertuples()][::-1]

    def search(self, q, limit=20):
        t = toks(q); res = []
        if not t: return res
        for pid, nm in self.s["name"].items():
            nt = " ".join(toks(nm))
            if all(x in nt for x in t): res.append((self.s["n"].get(pid, 0), pid, nm))
        res.sort(reverse=True)
        return [dict(id=p, name=nm, g=p[0], matches=n, elo=round(self.s["elo"].get(p, 1500)),
                     rank=int(self.s["rank"][p]) if p in self.s["rank"] else None) for n, p, nm in res[:limit]]

    # ---------- průběžné učení: započtení nově dohraných zápasů do stavu (Elo, povrch, forma, H2H) ----------
    def apply_result(self, w, l, surf, day):
        s = self.s; K = F.kfac
        for k in ("elo", "n", "sn", "selo", "recent", "dates", "resid", "h2h", "last"): s.setdefault(k, {})
        ew, el = s["elo"].get(w, 1500.0), s["elo"].get(l, 1500.0); e = F.expct(ew, el)
        s["elo"][w] = ew + K(s["n"].get(w, 0)) * (1 - e); s["elo"][l] = el - K(s["n"].get(l, 0)) * (1 - e)
        sw, sl = s["selo"].get((w, surf), 1500.0), s["selo"].get((l, surf), 1500.0); se = F.expct(sw, sl)
        s["selo"][(w, surf)] = sw + K(s["sn"].get((w, surf), 0)) * (1 - se); s["selo"][(l, surf)] = sl - K(s["sn"].get((l, surf), 0)) * (1 - se)
        for p in (w, l): s["n"][p] = s["n"].get(p, 0) + 1; s["sn"][(p, surf)] = s["sn"].get((p, surf), 0) + 1
        for p, res, ex in ((w, 1, e), (l, 0, 1 - e)):
            s["recent"][p] = (s["recent"].get(p, []) + [res])[-10:]; s["dates"][p] = (s["dates"].get(p, []) + [day])[-40:]
            s["resid"][p] = (s["resid"].get(p, []) + [(day, res - ex)])[-60:]; s["last"][p] = max(day, s["last"].get(p, 0))
        s["h2h"][(w, l)] = s["h2h"].get((w, l), 0) + 1

    def known_result(self, a, b, day, window=10):
        m = self.matches
        if not hasattr(self, "_recent_pairs"):
            r = m[m.date >= m.date.max() - __import__("pandas").Timedelta(days=60)]
            self._recent_pairs = {}
            for w, l, d in zip(r.wid, r.lid, r.date): self._recent_pairs.setdefault(frozenset((w, l)), []).append(d.toordinal())
        return any(abs(d - day) <= window for d in self._recent_pairs.get(frozenset((a, b)), []))
