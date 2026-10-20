import os, sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "backend"))
os.environ["TENIS_NO_POLL"] = "1"
import pandas as pd, pytest
import markov, features as F, sources as S

def test_markov_basics():
    assert abs(markov.game(0.5) - 0.5) < 1e-9
    assert markov.game(0.64) > 0.75
    assert abs(markov.match_prob(0.62, 0.62) - 0.5) < 1e-9
    assert markov.match_prob(0.62, 0.62, sa=2) == 1.0
    a, b = markov.serve_probs(0.7); assert abs(markov.match_prob(a, b) - 0.7) < 1e-3
    # vedení zvyšuje šanci
    assert markov.live(0.5, [(6, 3)], (0, 0))["match"] > 0.5
    assert markov.live(0.5, [], (5, 0), (3, 0), 1)["set"] > 0.95
    serving = markov.live(0.55, [], (5, 4), (0, 0), 1)
    returning = markov.live(0.55, [], (5, 4), (0, 0), 2)
    unknown = markov.live(0.55, [], (5, 4), (0, 0), None)
    assert serving["match"] > returning["match"]
    assert unknown["game"] is None and serving["game"] is not None
    assert abs(unknown["match"] - (serving["match"] + returning["match"]) / 2) < 1e-9

def test_no_leakage():
    d = pd.DataFrame(dict(date=pd.to_datetime(["2020-01-06"] * 2), tourney_id=["t", "t"], rord=[9, 10], match_num=[1, 2],
        wid=["M1", "M1"], lid=["M2", "M2"], winner_name=["A", "A"], loser_name=["B", "B"], surface=["Hard"] * 2, g=["M"] * 2,
        circuit=["ATP"] * 2, tourney_level=["A"] * 2, best_of=[3, 3], is_qual=[0, 0], winner_rank=[1, 1], loser_rank=[2, 2],
        winner_age=[20, 20], loser_age=[20, 20]))
    X, st = F.build(d)
    assert X.iloc[0].elo_d == 0 and X.iloc[0].h2h_d == 0  # první zápas: žádná informace o výsledku
    assert abs(X.iloc[1].h2h_d) == 1 and X.iloc[1].elo_d != 0  # druhý vidí jen první

def test_surname_key():
    assert S.surname_key("Sinner J.") == S.surname_key("Jannik Sinner") == "sinner"

@pytest.mark.skipif(not (F.ROOT / "data/model/gbm.txt").exists(), reason="model není natrénovaný")
def test_api():
    from fastapi.testclient import TestClient
    import app
    with TestClient(app.app) as c:
        assert c.get("/api/model").json()["test"]["lightgbm"]["accuracy"] > 0.6
        r = c.get("/api/players", params=dict(q="sinner")).json(); assert r
        a = r[0]["id"]; b = c.get("/api/players", params=dict(q="alcaraz")).json()[0]["id"]
        p1 = c.get("/api/predict", params=dict(a=a, b=b)).json()["p"]; p2 = c.get("/api/predict", params=dict(a=b, b=a)).json()["p"]
        assert abs(p1 + p2 - 1) < 1e-6  # symetrie
        assert "Sinner" in c.get("/api/chat", params=dict(q="Sinner vs Alcaraz")).json()["answer"]
        assert c.get("/").status_code == 200
