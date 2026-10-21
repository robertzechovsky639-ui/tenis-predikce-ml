"""Kalibrace bez úniku: logit(p) a logit(p)·(odehrané gemy / typická délka) — délka zápasu se dopředu nezná.
Fit na 2011–2018, test 2019–2024; nad baseline i nad bayes(k=400)."""
import sys, math, json, pathlib
import numpy as np
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from eval_live import preds, summ, ll, boot, TR, TE
from sklearn.linear_model import LogisticRegression
from multiprocessing import Pool
def X(P, R):
    out = []
    for p, r in zip(P, R):
        L = 38.0 if r["bo"] == 5 else 22.0
        for q, c in zip(p, r["cps"]):
            g = sum(a + b for a, b in c["done"]) + sum(c["cur"]); z = math.log(q / (1 - q)); out.append([z, z * min(g / L, 1.5)])
    return np.array(out)
def Y(R): return np.concatenate([np.full(len(r["cps"]), r["y"]) for r in R])
def split(v, P):
    o, i = [], 0
    for p in P: o.append(np.clip(v[i:i + len(p)], 1e-4, 1 - 1e-4)); i += len(p)
    return o
if __name__ == "__main__":
    with Pool(4) as pool: btr, bte, ytr_, yte_ = pool.starmap(preds, [(TR, None), (TE, None), (TR, 400), (TE, 400)])
    res = {}
    base = summ(bte, TE); bay = summ(yte_, TE); res["baseline"] = base; res["bayes400"] = bay
    for name, tr, te in (("calib_baseline", btr, bte), ("calib_bayes", ytr_, yte_)):
        lr = LogisticRegression(C=1e6, fit_intercept=False).fit(X(tr, TR), Y(TR)); P = split(lr.predict_proba(X(te, TE))[:, 1], te)
        res[name] = summ(P, TE); res[name]["coef"] = [round(float(c), 4) for c in lr.coef_[0]]
        res[name]["ci_vs_baseline"] = boot(ll(bte, TE), ll(P, TE), TE)
        if name == "calib_bayes": res[name]["ci_vs_bayes"] = boot(ll(yte_, TE), ll(P, TE), TE)
    res["bayes400"]["ci_vs_baseline"] = boot(ll(bte, TE), ll(yte_, TE), TE)
    json.dump(res, open("/workspace/pbp/live_eval_calib.json", "w"), indent=1); print(json.dumps(res, indent=1))
