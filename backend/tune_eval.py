"""Výběr lepšího modelu bez úniku.

Výběr jen na roce 2023 (early stopping na 2022). Vítěz se pak jednou změří stejným protokolem
jako publikovaný model: early stopping na 2023, test 2024 a dál. Do tréninku se dostane jen když
na testu zlepší log loss a nezhorší přesnost.

Spuštěno 2026-10-20, výsledek data/model/tune_result.json: keep=false.
Na testu 2024+ (n=153987) základ 70,47 % / log loss 0,5605, nejlepší kandidát z roku 2023
(povrchové Elo + forma na povrchu + poločas 6 let) 70,41 % / 0,5606. Příznaky se proto do
features.py nevrátily. Znovu to pustí jen TUNE_RERUN=1, a to když row() zase obsahuje sloupce
selo_p, bel_d, sform_d, form5_d a sh2h_d.
"""
import datetime, json, os, pickle, time
import numpy as np, lightgbm as lgb
import features as F
from train import metrics, SPLIT

CACHE = F.ROOT / "data" / "model" / "feat_cache.pkl"
BASE = list(F.FEATURES)
EXTRA = ["selo_p", "bel_d", "sform_d", "form5_d", "sh2h_d"]
P0 = dict(objective="binary", learning_rate=0.05, num_leaves=63, min_data_in_leaf=200, feature_fraction=0.8,
          bagging_fraction=0.8, bagging_freq=1, lambda_l2=1.0, verbose=-1, num_threads=max(1, (os.cpu_count() or 2) - 0))
P1 = dict(P0, learning_rate=0.03, num_leaves=127, min_data_in_leaf=100, lambda_l2=2.0)


def load_xy():
    if CACHE.exists():
        print("cache", CACHE, flush=True)
        X = pickle.load(open(CACHE, "rb"))
        if X.columns.duplicated().any():
            X = X.loc[:, ~X.columns.duplicated()]
        return X
    t = time.time(); df = F.load(); X, _ = F.build(df)
    X = X[X.date >= datetime.date(1970, 1, 1).toordinal()].reset_index(drop=True)
    cols = ["date", "y", "circuit"] + BASE + EXTRA
    X = X[cols]
    pickle.dump(X, open(CACHE, "wb"), protocol=4)
    print("příznaky", len(X), "za", round(time.time() - t), "s")
    return X


def weights(dates, half_life, end):
    if not half_life:
        return None
    age = (end - dates.to_numpy()) / 365.25
    return np.exp(-np.log(2) * age / half_life).astype(np.float32)


def fit_predict(X, feats, params, es_year, score_from, score_to, half_life=None):
    es = datetime.date(es_year, 1, 1).toordinal()
    fit, val = X[X.date < es], X[(X.date >= es) & (X.date < score_from)]
    te = X[(X.date >= score_from) & (X.date < score_to)] if score_to else X[X.date >= score_from]
    wfit = weights(fit.date, half_life, es)
    wval = weights(val.date, half_life, es)
    dfit = lgb.Dataset(fit[feats], fit.y, weight=wfit)
    dval = lgb.Dataset(val[feats], val.y, weight=wval, reference=dfit)
    g = lgb.train(params, dfit, 2000, valid_sets=[dval], callbacks=[lgb.early_stopping(50, verbose=False)])
    p = g.predict(te[feats], num_iteration=g.best_iteration)
    return metrics(te.y, p), int(g.best_iteration)


def main():
    saved = F.ROOT / "data" / "model" / "tune_result.json"
    if os.environ.get("TUNE_RERUN") != "1":
        print(saved.read_text() if saved.exists() else "výsledek chybí")
        print("keep=false, produkční příznaky beze změny (TUNE_RERUN=1 by měření opakoval)")
        return
    t0 = time.time(); X = load_xy()
    y2022, y2023, y2024 = (datetime.date(y, 1, 1).toordinal() for y in (2022, 2023, 2024))
    configs = [
        ("base", BASE, P0, None),
        ("surf", BASE + ["selo_p", "bel_d"], P0, None),
        ("surf+form", BASE + EXTRA, P0, None),
        ("surf+form+w6", BASE + EXTRA, P0, 6.0),
        ("surf+form+leaves", BASE + EXTRA, P1, None),
    ]
    board = []
    for name, feats, params, half in configs:
        print("fit", name, flush=True)
        m, iters = fit_predict(X, feats, params, 2022, y2023, y2024, half)
        board.append(dict(name=name, val=m, iters=iters))
        print("val2023", name, m, "iters", iters, flush=True)
    best = min(board, key=lambda r: r["val"]["log_loss"])
    # jediné měření na testu: stejný protokol jako train.py
    print("fit test", best["name"], flush=True)
    base_te, base_it = fit_predict(X, BASE, P0, 2023, y2024, None, None)
    spec = next(c for c in configs if c[0] == best["name"])
    win_te, win_it = fit_predict(X, spec[1], spec[2], 2023, y2024, None, spec[3])
    keep = win_te["log_loss"] < base_te["log_loss"] and win_te["accuracy"] >= base_te["accuracy"]
    out = dict(baseline_test=base_te, baseline_iters=base_it, chosen=best["name"], chosen_val=best["val"],
               chosen_test=win_te, chosen_iters=win_it, keep=bool(keep), board=board,
               features=spec[1], half_life=spec[3], params={k: spec[2][k] for k in ("learning_rate", "num_leaves", "min_data_in_leaf", "lambda_l2")})
    dest = F.ROOT / "data" / "model" / "tune_result.json"
    json.dump(out, open(dest, "w"), indent=1)
    print(json.dumps(out, indent=1))
    print("celkem", round(time.time() - t0), "s")


if __name__ == "__main__":
    main()
