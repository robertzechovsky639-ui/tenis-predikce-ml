"""Vyhodnocení živých modelů na kontrolních bodech (začátek každého gemu). Párový bootstrap po zápasech pro rozdíly."""
import sys, pickle, math, json, pathlib
import numpy as np
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "backend")); sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from live_backtest import live_pp
rows = pickle.load(open("/workspace/pbp/rows.pkl", "rb"))
TR = [r for r in rows if r["year"] <= 2018]; TE = [r for r in rows if r["year"] >= 2019]

def post(p0, sv, k):
    return (k * p0 + sv[1]) / (k + sv[0]) if k else p0

def preds(R, k=None):
    out = []
    for r in R:
        ps = []
        for c in r["cps"]:
            pa = post(r["pa0"], c["sv"]["1"] if "1" in c["sv"] else c["sv"][1], k) if k else r["pa0"]
            pb = post(r["pb0"], c["sv"]["2"] if "2" in c["sv"] else c["sv"][2], k) if k else r["pb0"]
            ps.append(live_pp(min(max(pa, .3), .95), min(max(pb, .3), .95), c, r["bo"]))
        out.append(np.clip(np.array(ps), 1e-4, 1 - 1e-4))
    return out

def ll(P, R): return np.array([-(r["y"] * np.log(p) + (1 - r["y"]) * np.log(1 - p)).mean() for p, r in zip(P, R)])
def br(P, R): return np.array([((p - r["y"]) ** 2).mean() for p, r in zip(P, R)])
def summ(P, R):
    allp = np.concatenate(P); ally = np.concatenate([np.full(len(p), r["y"]) for p, r in zip(P, R)])
    return dict(log_loss=round(float(-(ally * np.log(allp) + (1 - ally) * np.log(1 - allp)).mean()), 4), brier=round(float(((allp - ally) ** 2).mean()), 4),
                accuracy=round(float(((allp > .5) == ally).mean()), 4), n_cp=int(len(allp)))
def boot(a, b, R, B=2000, seed=1):
    """rozdíl průměrného log loss na kontrolní bod (b - a), bootstrap po zápasech"""
    rng = np.random.default_rng(seed); w = np.array([len(r["cps"]) for r in R]); da = a * w; db = b * w; out = []
    for _ in range(B):
        i = rng.integers(0, len(R), len(R)); out.append((db[i].sum() - da[i].sum()) / w[i].sum())
    return float(np.percentile(out, 2.5)), float(np.percentile(out, 97.5))

if __name__ == "__main__":
    print("trénink", len(TR), "test", len(TE))
    base_tr = preds(TR); res = {"baseline_train": summ(base_tr, TR)}
    best = None
    from multiprocessing import Pool
    KS = [50, 100, 200, 400, 800, 1600]
    with Pool(6) as pool: outs = pool.starmap(preds, [(TR, k) for k in KS])
    for k, P in zip(KS, outs):
        s = summ(P, TR); res[f"bayes_k{k}_train"] = s; print("k", k, s, flush=True)
        if best is None or s["log_loss"] < best[1]: best = (k, s["log_loss"])
    k = best[0]
    # Platt kalibrace podle stavu: logit(p), logit(p)*podíl odehraných gemů, na tréninku
    def feats(P, R):
        X = []
        for p, r in zip(P, R):
            n = len(r["cps"])
            for i, q in enumerate(p): z = math.log(q / (1 - q)); X.append([z, z * i / max(n - 1, 1)])
        return np.array(X)
    from sklearn.linear_model import LogisticRegression
    ytr = np.concatenate([np.full(len(p), r["y"]) for p, r in zip(base_tr, TR)])
    lr = LogisticRegression(C=1e6, fit_intercept=False).fit(feats(base_tr, TR), ytr)
    print("platt coef", lr.coef_)
    base_te = preds(TE); bay_te = preds(TE, k)
    Xte = feats(base_te, TE); cal = lr.predict_proba(Xte)[:, 1]; cal_te = []; i = 0
    for p in base_te: cal_te.append(np.clip(cal[i:i + len(p)], 1e-4, 1 - 1e-4)); i += len(p)
    res.update(k=k, test=dict(baseline=summ(base_te, TE), bayes=summ(bay_te, TE), calib=summ(cal_te, TE)))
    lb, lby, lc = ll(base_te, TE), ll(bay_te, TE), ll(cal_te, TE)
    res["ci_logloss_diff"] = dict(bayes=boot(lb, lby, TE), calib=boot(lb, lc, TE))
    # pre-match only (konstantní předzápasová šance) pro srovnání
    pre_te = [np.full(len(r["cps"]), min(max(r["p"], 1e-4), 1 - 1e-4)) for r in TE]; res["test"]["jen_predzapas"] = summ(pre_te, TE)
    # kalibrační koše na testu
    def bins(P):
        allp = np.concatenate(P); ally = np.concatenate([np.full(len(p), r["y"]) for p, r in zip(P, TE)]); o = []
        for j in range(10):
            m = (allp >= j / 10) & (allp < (j + 1) / 10 + (j == 9))
            if m.any(): o.append([j / 10, int(m.sum()), round(float(allp[m].mean()), 3), round(float(ally[m].mean()), 3)])
        return o
    res["calibration"] = dict(baseline=bins(base_te), bayes=bins(bay_te))
    # podle odehraného setu
    res["by_set"] = {}
    for sidx in range(5):
        sel = [[i for i, c in enumerate(r["cps"]) if len(c["done"]) == sidx] for r in TE]
        if sum(map(len, sel)) < 500: continue
        f = lambda P: summ([p[s] for p, s in zip(P, sel) if s], [r for r, s in zip(TE, sel) if s])
        res["by_set"][sidx + 1] = dict(baseline=f(base_te), bayes=f(bay_te), calib=f(cal_te))
    json.dump(res, open("/workspace/pbp/live_eval.json", "w"), indent=1, ensure_ascii=False); print(json.dumps(res, indent=1, ensure_ascii=False))
