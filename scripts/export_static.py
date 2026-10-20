"""Statický export pro GitHub Pages: předzápasové predikce, detaily zápasů, model, hráči (pro vlastní predikci v prohlížeči).
Živé skóre si pak prohlížeč stahuje sám (ESPN / 365scores / Flashscore, CORS) každé ~4 s."""
import json, math, os, pathlib, shutil, sys, time
ROOT = pathlib.Path(__file__).resolve().parents[1]; sys.path.insert(0, str(ROOT / "backend"))
os.environ["TENIS_NO_POLL"] = "1"
from service import Service, F
OUT = ROOT / "dist"

def incremental(svc):
    """Přepočte Elo/formu/H2H z vydaného stavu a seznamu zápasů. Stromy nemění.

    Při chybě vrátí hodnocení zpět a state.json nenechá přepsat (druhá hodnota None).
    """
    import datetime
    import ingest, online
    sources = [online.read_state(F.ROOT / "data" / "online" / "state.published.json"),
               online.read_state(F.ROOT / "data" / "online-cache" / "state.json")]
    if ingest.CSV.exists():
        try:
            import pandas as pd
            sources.append(pd.read_csv(ingest.CSV))
        except Exception as e:
            print("live_results.csv nečitelné:", e)
    try:
        sources.append(ingest.fetch_finished(range(-3, 1)))
    except Exception as e:
        print("flashscore výsledky nedostupné:", e)
    try:
        rows = online.collect_matches(sources, today=datetime.datetime.now(ingest.S.TZ).date())
        n, _ = online.apply_safe(svc.P, rows)
    except Exception as e:
        print("průběžné učení selhalo:", e)
        return 0, None
    try:
        online.write_state(F.ROOT / "data" / "online-cache" / "state.json", rows)
    except Exception as e:
        print("záloha state.json se neuložila:", e)
    print("průběžně započteno:", n, "z", len(rows), "zápasů v okně")
    return n, rows

def publish_state(kept):
    import online
    dest = OUT / "data" / "state.json"
    if kept is not None:
        online.write_state(dest, kept)
        return
    prev = F.ROOT / "data" / "online-cache" / "state.json"
    if prev.exists():
        shutil.copyfile(prev, dest)

def main():
    t0 = time.time(); svc = Service()
    n_inc, kept = incremental(svc)
    svc.poll_once(True); svc.opool.shutdown(wait=True)  # počkat na kurzy
    svc.opool = __import__("concurrent.futures").futures.ThreadPoolExecutor(1)
    svc.poll_once(True)
    if OUT.exists(): shutil.rmtree(OUT)
    shutil.copytree(ROOT / "web", OUT); (OUT / "data" / "m").mkdir(parents=True)
    publish_state(kept)
    ids = {p for ms in svc.days.values() for m in ms for p in (m.get("pids") or []) if p}
    M = svc.P.matches; svc.P.matches = M[M.wid.isin(ids) & M.lid.isin(ids)]  # zrychlení H2H dotazů
    allm = []
    for d, ms in svc.days.items():
        for m in ms:
            allm.append({k: v for k, v in m.items() if k != "_sig"})
            det = svc.detail(m["id"])
            json.dump(det, open(OUT / "data" / "m" / f"{m['id']}.json", "w"), ensure_ascii=False, separators=(",", ":"))
    P = svc.P; s = P.s
    json.dump(dict(generated=time.time(), status=svc.status, matches=allm), open(OUT / "data" / "matches.json", "w"), ensure_ascii=False, separators=(",", ":"))
    mj = json.load(open(F.ROOT / "data" / "model" / "metrics.json"))
    mj["incremental"] = dict(applied=n_inc, at=time.time())
    hp = F.ROOT / "data" / "model" / "retrain_history.json"; mj["history"] = json.load(open(hp)) if hp.exists() else []
    json.dump(mj, open(OUT / "data" / "model.json", "w"), ensure_ascii=False)
    json.dump(dict(features=F.FEATURES, mean=P.sc.mean_.tolist(), scale=P.sc.scale_.tolist(), coef=P.lr.coef_[0].tolist(),
                   intercept=float(P.lr.intercept_[0]), ref_day=P.ref_day), open(OUT / "data" / "lr.json", "w"))
    # hráči aktivní od 2022 (pro vyhledávání a vlastní predikci v prohlížeči)
    import datetime
    cut = datetime.date(2022, 1, 1).toordinal(); pl = []
    for pid, last in s["last"].items():
        if last < cut: continue
        r = s["recent"].get(pid, []); rs = [x for dd, x in s["resid"].get(pid, []) if P.ref_day - dd <= 60]
        pl.append([pid, s["name"][pid], round(s["elo"].get(pid, 1500)), [round(s["selo"].get((pid, x), 1500)) for x in ("Hard", "Clay", "Grass")],
                   int(s["rank"][pid]) if pid in s["rank"] else None, round(sum(r) / len(r), 2) if r else 0.5, s["n"].get(pid, 0),
                   min(P.ref_day - last, 365), sum(1 for dd in s["dates"].get(pid, []) if P.ref_day - dd <= 14),
                   round(sum(rs) / len(rs), 4) if rs else 0, round(s["age"].get(pid) or 25, 1),
                   *( [round(sum(x[0] for x in sv) / len(sv), 4), round(sum(x[1] for x in sv) / len(sv), 4)] if (sv := s.get("srv", {}).get(pid)) else [None, None])])
    json.dump(pl, open(OUT / "data" / "players.json", "w"), ensure_ascii=False, separators=(",", ":"))
    (OUT / ".nojekyll").write_text("")
    print("export", len(allm), "zápasů,", len(pl), "hráčů,", round(time.time() - t0), "s")

if __name__ == "__main__":
    main()
