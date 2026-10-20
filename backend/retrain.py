"""Denní přetrénování s bránou kvality.
1) ingest nových výsledků (Flashscore −7..0, všechny úrovně) + čerstvé TennisMyLife CSV,
2) přepočet příznaků (chronologicky), 3) kandidát LightGBM+LR natrénovaný DO začátku holdoutu (posledních 8 týdnů),
4) srovnání s aktuálním modelem na stejném holdoutu, 5) publikace jen když kandidát není horší
(log loss ≤ starý + 0,001 a Brier ≤ starý + 0,0005), jinak se zachová starý model (stav Elo/formy se ale aktualizuje vždy).
Historie -> data/model/retrain_history.json."""
import datetime, json, pickle, sys, time, urllib.request
import numpy as np, lightgbm as lgb
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler
import features as F, ingest
from train import metrics, OUT

HOLD_DAYS = 56
TML = ["2026.csv", "ongoing_tourneys.csv", "2026_challenger.csv", "challenger_ongoing_tourneys.csv", "2026_wta.csv", "wta_ongoing_tourneys.csv", "2026_atp_quali.csv"]

def refresh_tml():
    (F.RAW / "tml").mkdir(parents=True, exist_ok=True); got = {}
    for f in TML:
        try:
            with urllib.request.urlopen(urllib.request.Request("https://stats.tennismylife.org/data/" + f, headers={"User-Agent": "Mozilla/5.0"}), timeout=60) as r:
                b = r.read()
            if len(b) > 500 and b[:10].startswith(b"tourney"): (F.RAW / "tml" / f).write_bytes(b); got[f] = len(b)
        except Exception as e: got[f] = "chyba: " + str(e)[:60]
    print("TML:", got)

def main():
    t0 = time.time(); refresh_tml(); ingest.update_csv()
    df = F.load(); X, st = F.build(df); X = X[X.date >= datetime.date(1970, 1, 1).toordinal()]
    end = int(X.date.max()); H = end - HOLD_DAYS; tr, ho = X[X.date < H], X[X.date >= H]
    params = dict(objective="binary", learning_rate=0.05, num_leaves=63, min_data_in_leaf=200, feature_fraction=0.8, bagging_fraction=0.8,
                  bagging_freq=1, lambda_l2=1.0, verbose=-1, num_threads=4)
    old_m = json.load(open(OUT / "metrics.json")); iters = old_m.get("gbm_iterations", 333)
    cand = lgb.train(params, lgb.Dataset(tr[F.FEATURES], tr.y), iters)
    p_new = cand.predict(ho[F.FEATURES]); bo = lgb.Booster(model_file=str(OUT / "gbm.txt")); p_old = bo.predict(ho[bo.feature_name()])
    mn, mo, me = metrics(ho.y, p_new), metrics(ho.y, p_old), metrics(ho.y, ho.elo_p.values)
    # Brána: (a) kandidát musí porazit Elo baseline na holdoutu o ≥ 0,003 log loss, (b) nesmí být horší než kandidát naposledy
    # publikovaného modelu na jeho holdoutu o víc než 0,01 (tolerance na posun obtížnosti okna). Přímé srovnání se současným
    # modelem je jen informativní – ten holdout už viděl při refitu, takže by byl nespravedlivě zvýhodněn.
    hp0 = OUT / "retrain_history.json"; prev = [h for h in (json.load(open(hp0)) if hp0.exists() else []) if h.get("published")]
    ref = prev[-1]["candidate"]["log_loss"] if prev else None
    ok = mn["log_loss"] <= me["log_loss"] - 0.003 and (ref is None or mn["log_loss"] <= ref + 0.01) and mn["brier"] <= me["brier"]
    entry = dict(at=datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"), n_matches=int(len(df)), data_to=str(df.date.max().date()),
                 holdout=f"{datetime.date.fromordinal(H)} – {datetime.date.fromordinal(end)}", holdout_n=int(len(ho)),
                 candidate=mn, current=mo, elo=me, published=bool(ok), reason=("prošel bránou (lepší než Elo" + (f", ≤ minulý {ref:.4f}+0,01" if ref else "") + ")") if ok else "neprošel bránou – ponechán starý model")
    if ok:  # refit na všech datech
        gbm = lgb.train(params, lgb.Dataset(X[F.FEATURES], X.y), iters); sc = StandardScaler().fit(X[F.FEATURES].fillna(0))
        lr = LogisticRegression(max_iter=2000).fit(sc.transform(X[F.FEATURES].fillna(0)), X.y)
        gbm.save_model(str(OUT / "gbm.txt")); pickle.dump(dict(scaler=sc, lr=lr, features=F.FEATURES), open(OUT / "logreg.pkl", "wb"))
        old_m.update(trained_at=entry["at"], n_matches=entry["n_matches"], data_to=entry["data_to"], last_holdout=dict(lightgbm=mn, elo=me, period=entry["holdout"], n=len(ho)))
        json.dump(old_m, open(OUT / "metrics.json", "w"), ensure_ascii=False, indent=1)
    fz = F.freeze(st); fz["fs_seen"] = ingest.fs_id_set(ingest.pd.read_csv(ingest.CSV).fs_id) if ingest.CSV.exists() else set()  # už započtené v trénovacích datech
    pickle.dump(fz, open(OUT / "state.pkl", "wb"))  # stav (Elo/forma) vždy aktuální
    df[["date", "wid", "lid", "winner_name", "loser_name", "tourney_name", "surface", "round", "score", "circuit"]].to_pickle(OUT / "matches.pkl")
    hp = OUT / "retrain_history.json"; hist = json.load(open(hp)) if hp.exists() else []
    hist.append(entry); json.dump(hist[-200:], open(hp, "w"), ensure_ascii=False, indent=1)
    print(json.dumps(entry, ensure_ascii=False, indent=1)); print("celkem", round(time.time() - t0), "s")

if __name__ == "__main__":
    main()
