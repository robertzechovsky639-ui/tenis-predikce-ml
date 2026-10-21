"""Experiment v5: rozšířené příznaky (forma na povrchu, forma posl. 5, únava 3/7 dní, H2H na povrchu)
proti současnému modelu na STEJNÉM chronologickém rozdělení (test 2024+). Výsledek -> data/model/experiment_ext.json."""
import json, datetime, math
from collections import defaultdict, deque
import numpy as np, lightgbm as lgb
import features as F
from train import metrics, SPLIT

EXT = ["sform_d", "form5_d", "fat3_d", "fat7_d", "sh2h_d"]

class ExtState(F.State):
    def __init__(self):
        super().__init__(); self.srecent = defaultdict(lambda: deque(maxlen=10)); self.sh2h = defaultdict(int); self._cur = None
    def row(self, a, b, surf, day, *args):
        A, B, f = super().row(a, b, surf, day, *args)
        def sf(p):
            r = self.srecent[(p, surf)]; return sum(r) / len(r) if r else 0.5
        def f5(p):
            r = list(self.recent[p])[-5:]; return sum(r) / len(r) if r else 0.5
        def fat(p, k): return sum(1 for d in self.dates[p] if day - d <= k)
        f.update(sform_d=sf(a) - sf(b), form5_d=f5(a) - f5(b), fat3_d=fat(a, 3) - fat(b, 3), fat7_d=fat(a, 7) - fat(b, 7),
                 sh2h_d=self.sh2h[(a, b, surf)] - self.sh2h[(b, a, surf)])
        return A, B, f
    def update(self, w, l, surf, day):
        super().update(w, l, surf, day); self.srecent[(w, surf)].append(1); self.srecent[(l, surf)].append(0); self.sh2h[(w, l, surf)] += 1

def main():
    F.State = ExtState
    df = F.load(); X, _ = F.build(df)
    X = X[X.date >= datetime.date(1970, 1, 1).toordinal()]
    tr, te = X[X.date < SPLIT], X[X.date >= SPLIT]; vs = datetime.date(2023, 1, 1).toordinal()
    fit, val = tr[tr.date < vs], tr[tr.date >= vs]
    params = dict(objective="binary", learning_rate=0.05, num_leaves=63, min_data_in_leaf=200, feature_fraction=0.8,
                  bagging_fraction=0.8, bagging_freq=1, lambda_l2=1.0, verbose=-1, num_threads=8, seed=1)
    out = {}
    for name, feats in (("soucasny", F.FEATURES), ("rozsireny", F.FEATURES + EXT)):
        g = lgb.train(params, lgb.Dataset(fit[feats], fit.y), 2000, valid_sets=[lgb.Dataset(val[feats], val.y)],
                      callbacks=[lgb.early_stopping(50, verbose=False)])
        pr = g.predict(te[feats], num_iteration=g.best_iteration)
        out[name] = metrics(te.y, pr); out[name]["iter"] = g.best_iteration
        import track; out[name]["calibration"] = track.calibration([float(x) for x in pr], [int(x) for x in te.y])
        print(name, out[name], flush=True)
    out["lepsi"] = out["rozsireny"]["log_loss"] <= out["soucasny"]["log_loss"] and out["rozsireny"]["accuracy"] >= out["soucasny"]["accuracy"] - 0.0005
    json.dump(out, open(F.ROOT / "data/model/experiment_ext.json", "w"), ensure_ascii=False, indent=1)

if __name__ == "__main__":
    main()
