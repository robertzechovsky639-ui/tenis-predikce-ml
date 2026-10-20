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

def test_tiebreak_rotation_and_super():
    # První bod podává hráč, který je na řadě, pak se střídá po dvou. Stejně v supertiebreaku.
    seq = [(0, 0), (1, 0), (1, 1), (2, 1), (2, 2), (3, 2), (8, 8), (9, 8)]
    assert [markov.tb_server(1, p) for p in seq] == [1, 2, 2, 1, 1, 2, 1, 2]
    assert markov.tb_server(2, (1, 0)) == 1
    pa, pb = 0.66, 0.58
    # server v live() je podávající aktuálního bodu, ne automaticky ten z prvního bodu
    p0 = markov.set_prob(pa, pb, 6, 6, True, (0, 0))
    won = markov.set_prob(pa, pb, 6, 6, False, (1, 0))
    lost = markov.set_prob(pa, pb, 6, 6, False, (0, 1))
    assert abs(p0 - (pa * won + (1 - pa) * lost)) < 1e-9
    stuck = markov.live(0.55, [], (6, 6), (1, 0), 1)
    right = markov.live(0.55, [], (6, 6), (1, 0), 2)
    assert stuck["set"] != right["set"]
    # rozhodující set: tiebreak na 10. 8:6 ještě není konec, 7:4 v prvním setu ano.
    mid = markov.live(0.55, [(6, 4), (4, 6)], (6, 6), (8, 6), 1, best_of=3)
    assert 0 < mid["set"] < 1
    assert abs(mid["set"] - markov.set_prob(mid["pa"], mid["pb"], 6, 6, True, (8, 6), tb_to=10)) < 1e-9
    assert markov.live(0.55, [], (6, 6), (7, 4), 1)["set"] == 1
    over = markov.tiebreak(pa, pb, 10, 8, True, target=10)
    assert over == 1
    # Samostatný supertiebreak (místo rozhodujícího setu) a přepnutí podání změní šanci.
    mtb_a = markov.live(0.55, [(6, 4), (4, 6)], (0, 0), (5, 4), 1, best_of=3, match_tb=True)
    mtb_b = markov.live(0.55, [(6, 4), (4, 6)], (0, 0), (5, 4), 2, best_of=3, match_tb=True)
    assert mtb_a["game"] is None and mtb_b["set"] != mtb_a["set"]
    assert 0 < mtb_a["set"] < 1
    # Po tiebreaku podává příjemce prvního bodu. Na 0:0 je šance setu pro oba podávající stejná,
    # ale rozhodující set se hraje tiebreakem na 10 a to šanci zápasu změní.
    got = markov.match_prob(pa, pb, 1, 0, 6, 6, True, (0, 0), 3, tb_to=7)
    cur = markov.set_prob(pa, pb, 6, 6, True, (0, 0), tb_to=7)
    ps_next = markov.set_prob(pa, pb, 0, 0, False, tb_to=10)  # A podával první bod → další set podává B, na 10
    expect = cur * 1 + (1 - cur) * ps_next
    assert abs(got - expect) < 1e-9
    ordinary = cur * 1 + (1 - cur) * markov.set_prob(pa, pb, 0, 0, False, tb_to=7)
    assert abs(got - ordinary) > 1e-6

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
