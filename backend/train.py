"""Trénink: LightGBM (výsledná pravděpodobnost) + logistická regrese (vysvětlitelné faktory).
Chronologické rozdělení: trénink do 2023-12-31, test 2024-01-01 a dál."""
import json, pickle, time, datetime
import numpy as np, pandas as pd, lightgbm as lgb
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import accuracy_score, log_loss, brier_score_loss
import features as F

OUT = F.ROOT / "data" / "model"
SPLIT = datetime.date(2024, 1, 1).toordinal()

def metrics(y, p):
    p = np.clip(p, 1e-6, 1 - 1e-6)
    return dict(accuracy=round(float(accuracy_score(y, p > 0.5)), 4), log_loss=round(float(log_loss(y, p)), 4),
                brier=round(float(brier_score_loss(y, p)), 4), n=int(len(y)))

def main():
    t0 = time.time(); OUT.mkdir(parents=True, exist_ok=True)
    df = F.load(); print("zápasů:", len(df), "od", df.date.min().date(), "do", df.date.max().date())
    X, st = F.build(df); print("příznaky hotové", round(time.time() - t0), "s")
    X = X[X.date >= datetime.date(1970, 1, 1).toordinal()]  # první 2 roky jen zahřátí Elo
    tr, te = X[X.date < SPLIT], X[X.date >= SPLIT]
    # validace pro early stopping = poslední rok tréninku
    vsplit = datetime.date(2023, 1, 1).toordinal()
    fit, val = tr[tr.date < vsplit], tr[tr.date >= vsplit]
    params = dict(objective="binary", learning_rate=0.05, num_leaves=63, min_data_in_leaf=200, feature_fraction=0.8,
                  bagging_fraction=0.8, bagging_freq=1, lambda_l2=1.0, verbose=-1, num_threads=8)
    dfit = lgb.Dataset(fit[F.FEATURES], fit.y); dval = lgb.Dataset(val[F.FEATURES], val.y)
    gbm = lgb.train(params, dfit, 2000, valid_sets=[dval], callbacks=[lgb.early_stopping(50, verbose=False)])
    best = gbm.best_iteration; print("LightGBM iterací:", best)
    p_gbm = gbm.predict(te[F.FEATURES], num_iteration=best)
    sc = StandardScaler().fit(tr[F.FEATURES].fillna(0)); lr = LogisticRegression(max_iter=2000, C=1.0).fit(sc.transform(tr[F.FEATURES].fillna(0)), tr.y)
    p_lr = lr.predict_proba(sc.transform(te[F.FEATURES].fillna(0)))[:, 1]
    p_elo = te.elo_p.values
    ra, rb = te.rank_a.fillna(5000).values, te.rank_b.fillna(5000).values
    p_rank = np.where(ra < rb, 0.65, np.where(ra > rb, 0.35, 0.5))  # baseline: lépe postavený vyhraje
    rep = dict(trained_at=datetime.datetime.now().isoformat(timespec="seconds"), n_matches=int(len(df)),
               data_from=str(df.date.min().date()), data_to=str(df.date.max().date()),
               train_rows=int(len(tr)), test_rows=int(len(te)), split="trénink 1970–2023, test 2024–" + str(df.date.max().year),
               gbm_iterations=int(best),
               test=dict(lightgbm=metrics(te.y, p_gbm), logreg=metrics(te.y, p_lr), elo=metrics(te.y, p_elo), rank=metrics(te.y, p_rank)),
               by_circuit={})
    for c, g in te.groupby("circuit"):
        m = te.circuit == c
        rep["by_circuit"][c] = dict(lightgbm=metrics(g.y, p_gbm[m.values]), elo=metrics(g.y, p_elo[m.values]))
    imp = gbm.feature_importance("gain"); rep["importance"] = {f: round(float(v / imp.sum()), 4) for f, v in zip(F.FEATURES, imp)}
    # finální model: přetrénovat na všech datech se stejným počtem iterací
    gbm_all = lgb.train(params, lgb.Dataset(X[F.FEATURES], X.y), best)
    sc_all = StandardScaler().fit(X[F.FEATURES].fillna(0)); lr_all = LogisticRegression(max_iter=2000).fit(sc_all.transform(X[F.FEATURES].fillna(0)), X.y)
    gbm_all.save_model(str(OUT / "gbm.txt"))
    pickle.dump(dict(scaler=sc_all, lr=lr_all, features=F.FEATURES), open(OUT / "logreg.pkl", "wb"))
    pickle.dump(F.freeze(st), open(OUT / "state.pkl", "wb"))
    json.dump(rep, open(OUT / "metrics.json", "w"), ensure_ascii=False, indent=1)
    print(json.dumps(rep["test"], indent=1)); print("celkem", round(time.time() - t0), "s")

if __name__ == "__main__":
    main()
