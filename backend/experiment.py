"""Experiment: základní příznaky vs. + podání/return (Sackmann statistiky) vs. + izotonická kalibrace. Stejný chronologický split."""
import datetime, json, numpy as np, lightgbm as lgb
from sklearn.isotonic import IsotonicRegression
import features as F
from train import metrics, SPLIT
df = F.load(); X, st = F.build(df); X = X[X.date >= datetime.date(1970, 1, 1).toordinal()]
tr, te = X[X.date < SPLIT], X[X.date >= SPLIT]; v = datetime.date(2023, 1, 1).toordinal(); fit, val = tr[tr.date < v], tr[tr.date >= v]
P = dict(objective="binary", learning_rate=0.05, num_leaves=63, min_data_in_leaf=200, feature_fraction=0.8, bagging_fraction=0.8, bagging_freq=1, lambda_l2=1.0, verbose=-1, num_threads=8)
res = {}; print("pokrytí spw (test):", round(float(te.spw_d.notna().mean()), 3))
for name, feats in [("base", F.FEATURES), ("srv", F.FEATURES + F.SRV_FEATURES)]:
    g = lgb.train(P, lgb.Dataset(fit[feats], fit.y), 2000, valid_sets=[lgb.Dataset(val[feats], val.y)], callbacks=[lgb.early_stopping(50, verbose=False)])
    p = g.predict(te[feats], num_iteration=g.best_iteration); res[name] = dict(metrics(te.y, p), iters=g.best_iteration)
    pv = g.predict(val[feats], num_iteration=g.best_iteration); iso = IsotonicRegression(out_of_bounds="clip", y_min=1e-4, y_max=1 - 1e-4).fit(pv, val.y)
    res[name + "+iso"] = metrics(te.y, iso.predict(p))
    for c in ["ATP", "WTA", "Challenger"]:
        m = (te.circuit == c).values; res[f"{name}:{c}"] = metrics(te.y[m], p[m])["log_loss"]
print(json.dumps(res, indent=1)); json.dump(res, open(F.ROOT / "data" / "model" / "experiment.json", "w"), indent=1)
