"""Dopředný test dotrénování LightGBM na roce 2024 a dál.

Model se natrénuje jen z dat před 2024 (early stopping na 2023). Každý blok nových zápasů
se napřed vyhodnotí a teprve potom smí vstoupit do učení. Brána je stejná jako maybe_boost:
dotrénování se nechá jen když na posledních 500 zápasech klesne log loss aspoň o MIN_GAIN
a neklesne přesnost. Export tenhle postup nepoužívá — na testu 2024–2026 brána nepřijala
ani jeden blok a log loss se nezlepšil. Blok, podle kterého se brána rozhoduje, se do
zveřejněného skóre toho samého kroku nepočítá — skóre je vždycky až ten další blok.
"""
import datetime, json, os, pickle, time
import numpy as np, lightgbm as lgb
import features as F
from train import metrics, SPLIT
from online import HOLDOUT, MIN_TRAIN, MIN_GAIN, boost_from, gate_ok

CACHE = "/tmp/online_feat.pkl"
BASE = "/tmp/online_base.txt"
BLOCK = 2000


def load_xy():
    if os.path.exists(CACHE):
        print("cache", CACHE, flush=True)
        return pickle.load(open(CACHE, "rb"))
    t = time.time()
    df = F.load()
    X, _ = F.build(df)
    X = X[X.date >= datetime.date(1970, 1, 1).toordinal()].reset_index(drop=True)
    X = X[["date", "y"] + list(F.FEATURES)]
    pickle.dump(X, open(CACHE, "wb"), protocol=4)
    print("příznaky", len(X), "za", round(time.time() - t), "s", flush=True)
    return X


def fit_base(X):
    if os.path.exists(BASE):
        print("base cache", BASE, flush=True)
        return lgb.Booster(model_file=BASE)
    es = datetime.date(2023, 1, 1).toordinal()
    fit, val = X[X.date < es], X[(X.date >= es) & (X.date < SPLIT)]
    params = dict(objective="binary", learning_rate=0.05, num_leaves=63, min_data_in_leaf=200, feature_fraction=0.8,
                  bagging_fraction=0.8, bagging_freq=1, lambda_l2=1.0, verbose=-1, num_threads=4, seed=7)
    g = lgb.train(params, lgb.Dataset(fit[F.FEATURES], fit.y), 2000, valid_sets=[lgb.Dataset(val[F.FEATURES], val.y)],
                  callbacks=[lgb.early_stopping(50, verbose=False)])
    rounds = int(g.best_iteration)
    # stejný počet stromů, bez early-stopping příznaku, ať navázané stromy predikce opravdu použije
    g = lgb.train(params, lgb.Dataset(fit[F.FEATURES], fit.y), rounds)
    g.save_model(BASE)
    print("base iterací", rounds, flush=True)
    return g


def walk(base, te, min_gain):
    """min_gain None přijme každé dotrénování. Nové stromy vždy navazují na původní model."""
    model = base
    ps, ys = [], []
    accepted = tried = 0
    feats = list(F.FEATURES)
    for start in range(0, len(te), BLOCK):
        block = te.iloc[start:start + BLOCK]
        ps.append(model.predict(block[feats]))
        ys.append(block.y.to_numpy())
        seen = te.iloc[:start + len(block)]
        if len(seen) < MIN_TRAIN + HOLDOUT:
            continue
        tried += 1
        train, hold = seen.iloc[:-HOLDOUT], seen.iloc[-HOLDOUT:]
        m0 = metrics(hold.y, model.predict(hold[feats]))
        cand = boost_from(base, train)
        m1 = metrics(hold.y, cand.predict(hold[feats]))
        if min_gain is None or gate_ok(m0, m1, min_gain):
            model = cand
            accepted += 1
    out = metrics(np.concatenate(ys), np.concatenate(ps))
    out.update(accepted=accepted, tried=tried, blocks=int(np.ceil(len(te) / BLOCK)))
    return out


def main():
    t0 = time.time()
    X = load_xy()
    te = X[X.date >= SPLIT].reset_index(drop=True)
    base = fit_base(X)
    frozen = metrics(te.y, base.predict(te[F.FEATURES]))
    print("frozen", frozen, flush=True)
    gated = walk(base, te, MIN_GAIN)
    print("gated", gated, flush=True)
    ungated = walk(base, te, None)
    print("ungated", ungated, flush=True)
    result = dict(frozen=frozen, gated=gated, ungated=ungated, block=BLOCK, holdout=HOLDOUT, min_train=MIN_TRAIN,
                  rounds=3, lr=0.02, min_gain=MIN_GAIN, n=int(len(te)),
                  seconds=round(time.time() - t0))
    dest = F.ROOT / "data" / "model" / "online_eval.json"
    json.dump(result, open(dest, "w"), indent=1)
    print(json.dumps(result, indent=1))


if __name__ == "__main__":
    main()
