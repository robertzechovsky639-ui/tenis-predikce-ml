import os, sys, pathlib, json, subprocess
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "backend"))
os.environ["TENIS_NO_POLL"] = "1"
import track, markov

ROOT = pathlib.Path(__file__).resolve().parents[1]

def M(id, status, p=0.7, winner=None, odds=None, **kw):
    return dict(id=id, status=status, pred=p, winner=winner, ts=1792275000, players=[{"name": "A"}, {"name": "B"}],
                circuit="ATP", sets=[[6, 4], [6, 3]] if winner else [], odds=odds, **kw)

def test_only_prematch_predictions_count():
    rows = track.merge({}, [M("x", "finished", winner=1), M("y", "upcoming"), M("d", "upcoming", demo=True)])
    assert set(rows) == {"y"}  # dokončený bez předchozí predikce ani DEMO se nepočítá
    rows = track.merge(rows, [M("y", "finished", p=0.99, winner=2)])
    assert rows["y"]["winner"] == 2 and rows["y"]["p"] == 0.7  # predikce zůstává ta před zápasem

def test_prematch_odds_frozen_at_start():
    rows = track.merge({}, [M("y", "upcoming", odds=dict(best_a=2.0, best_b=1.8))])
    rows = track.merge(rows, [M("y", "live", odds=dict(best_a=5.0, best_b=1.1))])
    assert rows["y"]["odds"] == [2.0, 1.8]

def test_value_side():
    assert track.value_side(0.6, [2.0, 1.9]) == "A"   # 0,6*2 - 1 = 20 %
    assert track.value_side(0.3, [3.0, 1.6]) == "B"   # 0,7*1,6 - 1 = 12 %
    assert track.value_side(0.5, [1.9, 1.9]) is None
    assert track.value_side(0.5, None) is None

def test_summary_metrics_and_roi():
    rows = {}
    rows = track.merge(rows, [M("a", "upcoming", 0.8, odds=dict(best_a=1.5, best_b=2.6)), M("b", "upcoming", 0.6, odds=dict(best_a=2.0, best_b=1.8))])
    rows = track.merge(rows, [M("a", "finished", winner=1), M("b", "finished", winner=2)])
    s = track.summary(rows)
    assert s["n"] == 2 and s["accuracy"] == 0.5
    assert abs(s["brier"] - ((0.2 ** 2 + 0.6 ** 2) / 2)) < 1e-4
    assert s["value"]["n"] == 2 and s["value"]["profit"] == round(0.5 - 1.0, 2)
    assert sum(b["n"] for b in s["calibration"]) == 2

def test_calibration_bins():
    c = track.calibration([0.05, 0.15, 0.95, 1.0], [0, 0, 1, 1])
    assert [b["n"] for b in c] == [1, 1, 2] and c[-1]["real"] == 1.0

def test_live_recalculation_follows_score():
    pre = 0.6
    base = markov.live(pre, [], (0, 0), (0, 0), 1)["match"]
    assert abs(base - pre) < 2e-3  # na začátku = předzápasová predikce
    after_break = markov.live(pre, [], (3, 1), (0, 0), 1)["match"]
    lost_set = markov.live(pre, [(3, 6)], (0, 0), (0, 0), 1)["match"]
    assert after_break > base > lost_set
    seq = [markov.live(pre, [], (0, 0), pt, 1)["match"] for pt in [(0, 0), (1, 0), (2, 0), (3, 0)]]
    assert seq == sorted(seq)  # každý vyhraný bod šanci zvýší
    assert markov.live(pre, [(6, 0)], (5, 0), (3, 0), 1)["match"] > 0.99

def test_swing_notification_js():
    subprocess.check_call(["node", "tests/test_swing.js"], cwd=ROOT)

def test_api_track(tmp_path, monkeypatch):
    if not (ROOT / "data/model/gbm.txt").exists(): return
    from fastapi.testclient import TestClient
    import app
    monkeypatch.setattr(app, "TRACK_FILE", tmp_path / "track.json")
    with TestClient(app.app) as c:
        app.SVC.days[0] = [M("t1", "upcoming")]
        r = c.get("/api/track").json(); assert r["summary"]["pending"] == 1 and r["recent"][0]["id"] == "t1"
        app.SVC.days[0] = [M("t1", "finished", winner=1)]
        r = c.get("/api/track").json(); assert r["summary"]["n"] == 1 and r["summary"]["accuracy"] == 1.0

def test_api_factors_have_raw_values():
    if not (ROOT / "data/model/gbm.txt").exists(): return
    from fastapi.testclient import TestClient
    import app
    with TestClient(app.app) as c:
        a = c.get("/api/players", params=dict(q="sinner")).json()[0]["id"]; b = c.get("/api/players", params=dict(q="alcaraz")).json()[0]["id"]
        f = c.get("/api/predict", params=dict(a=a, b=b, surface="Clay")).json()["factors"]
        assert f and all("key" in x and "raw" in x and x["favors"] in "AB" for x in f)
        se = [x for x in f if x["key"] == "selo_d"]
        assert not se or (se[0]["raw"] > 0) == (se[0]["value"] > 0)  # vyšší Elo na povrchu pomáhá hráči A
